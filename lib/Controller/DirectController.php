<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Controller;

use OCA\Zeichenbrett\AppInfo\Application;
use OCA\Zeichenbrett\Service\DirectSessionService;
use OCA\Zeichenbrett\Service\InvalidTokenException;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\BruteForceProtection;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\StreamResponse;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IFilenameValidator;
use OCP\Files\IRootFolder;
use OCP\Files\NotPermittedException;
use OCP\IRequest;
use OCP\IUserManager;
use OCP\Lock\LockedException;
use Psr\Log\LoggerInterface;

/**
 * File access for the editor page opened by the mobile apps (Direct Editing).
 * There is no login session in that web view: every request carries a token from
 * DirectSessionService in the X-Zeichenbrett-Token header, bound to one user and file.
 */
class DirectController extends Controller {
	private const ACTION = 'zeichenbrett-direct';

	public function __construct(
		IRequest $request,
		private DirectSessionService $sessions,
		private IRootFolder $rootFolder,
		private IUserManager $userManager,
		private IFilenameValidator $filenameValidator,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[BruteForceProtection(action: self::ACTION)]
	public function getFile(): Response {
		try {
			[, $file] = $this->resolve();
		} catch (InvalidTokenException) {
			return $this->denied();
		}
		if (!$file->isReadable()) {
			return new JSONResponse([], Http::STATUS_FORBIDDEN);
		}
		$response = new StreamResponse($file->fopen('rb'));
		$response->addHeader('Content-Type', $file->getMimetype());
		$response->addHeader('Content-Length', (string)$file->getSize());
		$response->addHeader('ETag', '"' . $file->getEtag() . '"');
		$response->cacheFor(0);
		return $response;
	}

	/**
	 * Overwrite the file. The client sends the etag it loaded (If-Match); a mismatch
	 * means somebody else changed the file in the meantime (412), unless force=1.
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	#[BruteForceProtection(action: self::ACTION)]
	public function putFile(bool $force = false): JSONResponse {
		try {
			[, $file] = $this->resolve();
		} catch (InvalidTokenException) {
			return $this->denied();
		}
		if (!$file->isUpdateable()) {
			return new JSONResponse([], Http::STATUS_FORBIDDEN);
		}
		$ifMatch = trim($this->request->getHeader('If-Match'), '"');
		if (!$force && $ifMatch !== '' && $ifMatch !== $file->getEtag()) {
			return new JSONResponse(['etag' => $file->getEtag()], Http::STATUS_PRECONDITION_FAILED);
		}
		return $this->write(fn () => $file->putContent($this->body()), $file);
	}

	/** Does a file with this name exist next to the opened file? */
	#[PublicPage]
	#[NoCSRFRequired]
	#[BruteForceProtection(action: self::ACTION)]
	public function exists(string $name): JSONResponse {
		try {
			[, $file] = $this->resolve();
		} catch (InvalidTokenException) {
			return $this->denied();
		}
		if (!$this->filenameValidator->isFilenameValid($name)) {
			return new JSONResponse(['error' => 'invalid name'], Http::STATUS_BAD_REQUEST);
		}
		return new JSONResponse(['exists' => $file->getParent()->nodeExists($name)]);
	}

	/**
	 * Save as a copy next to the opened file. Answers with a token for the copy, so the
	 * editor can continue working in it.
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	#[BruteForceProtection(action: self::ACTION)]
	public function copy(string $name, bool $overwrite = false): JSONResponse {
		try {
			[$userId, $file] = $this->resolve();
		} catch (InvalidTokenException) {
			return $this->denied();
		}
		if (!$this->filenameValidator->isFilenameValid($name)) {
			return new JSONResponse(['error' => 'invalid name'], Http::STATUS_BAD_REQUEST);
		}
		$parent = $file->getParent();
		if ($parent->nodeExists($name)) {
			$existing = $parent->get($name);
			if (!$overwrite) {
				return new JSONResponse(['error' => 'exists'], Http::STATUS_CONFLICT);
			}
			if (!$existing instanceof File || !$existing->isUpdateable()) {
				return new JSONResponse([], Http::STATUS_FORBIDDEN);
			}
			$target = $existing;
			return $this->write(fn () => $target->putContent($this->body()), $target, $userId);
		}
		if (!$parent->isCreatable()) {
			return new JSONResponse([], Http::STATUS_FORBIDDEN);
		}
		return $this->write(fn () => $parent->newFile($name, $this->body()), null, $userId, $parent, $name);
	}

	/**
	 * @return array{0: string, 1: File}
	 * @throws InvalidTokenException
	 */
	private function resolve(): array {
		[$userId, $fileId] = $this->sessions->verify($this->request->getHeader('X-Zeichenbrett-Token'));
		$user = $this->userManager->get($userId);
		if ($user === null || !$user->isEnabled()) {
			throw new InvalidTokenException();
		}
		$file = $this->rootFolder->getUserFolder($userId)->getFirstNodeById($fileId);
		if (!$file instanceof File) {
			throw new InvalidTokenException();
		}
		return [$userId, $file];
	}

	/** @return resource */
	private function body() {
		$stream = $this->request->put;
		if (!is_resource($stream)) {
			throw new \InvalidArgumentException('empty body');
		}
		return $stream;
	}

	/**
	 * Run a write operation and answer with the file's new state (and a token for it).
	 */
	private function write(callable $op, ?File $file, ?string $userId = null, ?Folder $parent = null, ?string $name = null): JSONResponse {
		try {
			$op();
		} catch (LockedException) {
			return new JSONResponse(['error' => 'locked'], Http::STATUS_LOCKED);
		} catch (NotPermittedException) {
			return new JSONResponse([], Http::STATUS_FORBIDDEN);
		} catch (\InvalidArgumentException) {
			return new JSONResponse(['error' => 'empty body'], Http::STATUS_BAD_REQUEST);
		} catch (\Throwable $e) {
			$this->logger->error('Zeichenbrett could not save a file', ['exception' => $e]);
			return new JSONResponse(['error' => 'failed'], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
		$node = $parent !== null ? $parent->get($name) : $this->rootFolder->getFirstNodeById($file->getId());
		if (!$node instanceof File) {
			return new JSONResponse(['error' => 'failed'], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
		$result = ['etag' => $node->getEtag(), 'name' => $node->getName(), 'mime' => $node->getMimetype()];
		if ($userId !== null) {
			$result['token'] = $this->sessions->create($userId, $node->getId());
		}
		return new JSONResponse($result);
	}

	private function denied(): JSONResponse {
		$response = new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		$response->throttle(['action' => self::ACTION]);
		return $response;
	}
}
