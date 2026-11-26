<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Settings;

use OCA\Zeichenbrett\AppInfo\Application;
use OCA\Zeichenbrett\Service\DefaultsService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Settings\ISettings;
use OCP\Util;

class AdminSettings implements ISettings {
	public function __construct(
		private DefaultsService $defaults,
	) {
	}

	public function getForm(): TemplateResponse {
		Util::addScript(Application::APP_ID, Application::APP_ID . '-settings');
		Util::addTranslations(Application::APP_ID);
		Util::addStyle(Application::APP_ID, 'settings');
		return new TemplateResponse(Application::APP_ID, 'settings-admin', [
			'admin' => $this->defaults->getAdminDefaults(),
		]);
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 10;
	}
}
