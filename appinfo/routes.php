<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

return [
	'routes' => [
		['name' => 'settings#setAdmin', 'url' => '/settings/admin', 'verb' => 'POST'],
		['name' => 'settings#setUser', 'url' => '/settings/user', 'verb' => 'POST'],
		// Direct Editing (mobile apps): token in the X-Zeichenbrett-Token header
		['name' => 'direct#getFile', 'url' => '/direct/file', 'verb' => 'GET'],
		['name' => 'direct#putFile', 'url' => '/direct/file', 'verb' => 'PUT'],
		['name' => 'direct#exists', 'url' => '/direct/exists', 'verb' => 'GET'],
		['name' => 'direct#copy', 'url' => '/direct/copy', 'verb' => 'PUT'],
	],
];
