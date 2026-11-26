<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Controller;

use OCA\Zeichenbrett\AppInfo\Application;
use OCA\Zeichenbrett\Service\DefaultsService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use OCP\IUserSession;

class SettingsController extends Controller {
	public function __construct(
		IRequest $request,
		private DefaultsService $defaults,
		private IUserSession $userSession,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * Admin default (admin only: no #[NoAdminRequired])
	 */
	public function setAdmin(string $type, bool $enabled): JSONResponse {
		if (!DefaultsService::isValidType($type)) {
			return new JSONResponse(['error' => 'invalid type'], Http::STATUS_BAD_REQUEST);
		}
		$this->defaults->setAdminDefault($type, $enabled);
		return new JSONResponse(['admin' => $this->defaults->getAdminDefaults()]);
	}

	/**
	 * Personal choice: "yes", "no" or "" (follow the admin default)
	 */
	#[NoAdminRequired]
	public function setUser(string $type, string $value): JSONResponse {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		}
		if (!DefaultsService::isValidType($type) || !in_array($value, ['yes', 'no', ''], true)) {
			return new JSONResponse(['error' => 'invalid value'], Http::STATUS_BAD_REQUEST);
		}
		$this->defaults->setUserChoice($user->getUID(), $type, $value);
		return new JSONResponse(['user' => $this->defaults->getUserChoices($user->getUID())]);
	}
}
