<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

return [
	'routes' => [
		['name' => 'settings#setAdmin', 'url' => '/settings/admin', 'verb' => 'POST'],
		['name' => 'settings#setUser', 'url' => '/settings/user', 'verb' => 'POST'],
	],
];
