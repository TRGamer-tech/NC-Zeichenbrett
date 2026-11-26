<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Listener;

use OCA\Zeichenbrett\DirectEditing\Editor;
use OCP\DirectEditing\RegisterDirectEditorEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;

/**
 * @template-implements IEventListener<Event>
 */
class RegisterDirectEditorListener implements IEventListener {
	public function __construct(
		private Editor $editor,
	) {
	}

	public function handle(Event $event): void {
		if ($event instanceof RegisterDirectEditorEvent) {
			$event->register($this->editor);
		}
	}
}
