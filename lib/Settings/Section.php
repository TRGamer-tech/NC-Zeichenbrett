<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Settings;

use OCA\Zeichenbrett\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

class Section implements IIconSection {
	public function __construct(
		private IL10N $l,
		private IURLGenerator $urlGenerator,
		private IAppManager $appManager,
	) {
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l->t('Zeichenbrett');
	}

	public function getPriority(): int {
		return 80;
	}

	public function getIcon(): string {
		// versioned URL: static images are cached for months by browsers and proxies
		return $this->urlGenerator->imagePath(Application::APP_ID, 'app-dark.svg') . '?v=' . $this->appManager->getAppVersion(Application::APP_ID);
	}
}
