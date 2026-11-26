<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Settings;

use OCA\Zeichenbrett\AppInfo\Application;
use OCA\Zeichenbrett\Service\DefaultsService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IUserSession;
use OCP\Settings\ISettings;
use OCP\Util;

class PersonalSettings implements ISettings {
	public function __construct(
		private DefaultsService $defaults,
		private IUserSession $userSession,
	) {
	}

	public function getForm(): TemplateResponse {
		Util::addScript(Application::APP_ID, Application::APP_ID . '-settings');
		Util::addTranslations(Application::APP_ID);
		Util::addStyle(Application::APP_ID, 'settings');
		$uid = $this->userSession->getUser()?->getUID() ?? '';
		return new TemplateResponse(Application::APP_ID, 'settings-personal', [
			'admin' => $this->defaults->getAdminDefaults(),
			'user' => $this->defaults->getUserChoices($uid),
		]);
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 10;
	}
}
