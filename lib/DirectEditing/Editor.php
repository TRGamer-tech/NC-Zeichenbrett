<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\DirectEditing;

use OCA\Zeichenbrett\AppInfo\Application;
use OCA\Zeichenbrett\Service\DefaultsService;
use OCA\Zeichenbrett\Service\DirectSessionService;
use OCP\App\IAppManager;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Constants;
use OCP\DirectEditing\IEditor;
use OCP\DirectEditing\IToken;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Util;

/**
 * Makes Zeichenbrett available to the Nextcloud mobile apps ("Edit" in the file menu).
 *
 * The apps pick the first editor whose mimetypes contain the file type, falling back to
 * the optional mimetypes. Types the user chose to open in Zeichenbrett are reported as
 * mimetypes, all others as optional, so office editors keep precedence where the user
 * did not choose Zeichenbrett.
 */
class Editor implements IEditor {
	public const ID = 'zeichenbrett';
	public const SUPPORTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

	public function __construct(
		private IL10N $l,
		private IUserSession $userSession,
		private DefaultsService $defaults,
		private DirectSessionService $sessions,
		private IInitialState $initialState,
		private IURLGenerator $urlGenerator,
		private IAppManager $appManager,
	) {
	}

	public function getId(): string {
		return self::ID;
	}

	public function getName(): string {
		return $this->l->t('Zeichenbrett');
	}

	public function getMimetypes(): array {
		return array_values(array_intersect(self::SUPPORTED, $this->defaults->getEffectiveMimes($this->userSession->getUser()?->getUID())));
	}

	public function getMimetypesOptional(): array {
		return array_values(array_diff(self::SUPPORTED, $this->getMimetypes()));
	}

	public function getCreators(): array {
		return [];
	}

	public function isSecure(): bool {
		return false;
	}

	public function open(IToken $token): Response {
		$token->useTokenScope();
		$file = $token->getFile();
		$this->initialState->provideInitialState('direct', [
			'token' => $this->sessions->create($token->getUser(), $file->getId()),
			'name' => $file->getName(),
			'mime' => $file->getMimetype(),
			'canWrite' => ($file->getPermissions() & Constants::PERMISSION_UPDATE) !== 0,
			'canCreate' => ($file->getParent()->getPermissions() & Constants::PERMISSION_CREATE) !== 0,
			'version' => $this->appManager->getAppVersion(Application::APP_ID),
			'jsBase' => $this->urlGenerator->linkTo(Application::APP_ID, 'js/'),
		]);
		Util::addTranslations(Application::APP_ID);
		Util::addScript(Application::APP_ID, Application::APP_ID . '-direct');
		$response = new TemplateResponse(Application::APP_ID, 'direct', [], TemplateResponse::RENDER_AS_BASE);
		$response->cacheFor(0);
		return $response;
	}
}
