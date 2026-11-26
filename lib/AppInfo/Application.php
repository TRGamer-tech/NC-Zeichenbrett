<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\AppInfo;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\Zeichenbrett\Listener\CspListener;
use OCA\Zeichenbrett\Listener\LoadFilesScriptsListener;
use OCA\Zeichenbrett\Listener\RegisterDirectEditorListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\DirectEditing\RegisterDirectEditorEvent;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'zeichenbrett';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerEventListener(LoadAdditionalScriptsEvent::class, LoadFilesScriptsListener::class);
		$context->registerEventListener(AddContentSecurityPolicyEvent::class, CspListener::class);
		// Higher priority than the default (0): the mobile apps pick the FIRST editor that lists
		// a file type, and Zeichenbrett only lists the types the user chose it for.
		$context->registerEventListener(RegisterDirectEditorEvent::class, RegisterDirectEditorListener::class, 10);
	}

	public function boot(IBootContext $context): void {
	}
}
