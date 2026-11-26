<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Listener;

use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

/**
 * pdf.js renders in a Web Worker that is served from this app's js/ folder.
 *
 * @template-implements IEventListener<Event>
 */
class CspListener implements IEventListener {
	public function handle(Event $event): void {
		if (!($event instanceof AddContentSecurityPolicyEvent)) {
			return;
		}
		$policy = new EmptyContentSecurityPolicy();
		$policy->addAllowedWorkerSrcDomain('\'self\'');
		$policy->addAllowedWorkerSrcDomain('blob:');
		$event->addPolicy($policy);
	}
}
