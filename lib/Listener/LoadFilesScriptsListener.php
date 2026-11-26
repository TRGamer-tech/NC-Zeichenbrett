<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\Zeichenbrett\AppInfo\Application;
use OCA\Zeichenbrett\Service\DefaultsService;
use OCP\App\IAppManager;
use OCP\AppFramework\Services\IInitialState;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IUserSession;
use OCP\Util;

/**
 * Loads the small bootstrap script into the Files app. The heavy editor
 * (pdf.js, pdf-lib) is only fetched when the user actually opens a file.
 *
 * @template-implements IEventListener<Event>
 */
class LoadFilesScriptsListener implements IEventListener {
	public function __construct(
		private IInitialState $initialState,
		private DefaultsService $defaults,
		private IUserSession $userSession,
		private IAppManager $appManager,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof LoadAdditionalScriptsEvent)) {
			return;
		}
		$uid = $this->userSession->getUser()?->getUID();
		$this->initialState->provideInitialState('default-mimes', $this->defaults->getEffectiveMimes($uid));
		// cache buster for the lazily loaded editor files (Nextcloud lets browsers cache .js for 6 months)
		$this->initialState->provideInitialState('version', $this->appManager->getAppVersion(Application::APP_ID));
		Util::addTranslations(Application::APP_ID);
		Util::addScript(Application::APP_ID, Application::APP_ID . '-main');
	}
}
