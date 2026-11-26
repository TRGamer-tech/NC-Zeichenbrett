<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Service;

use OCA\Zeichenbrett\AppInfo\Application;
use OCP\Config\IUserConfig;
use OCP\IAppConfig;

/**
 * Which file types open in Zeichenbrett when clicked in Files.
 *
 * Admin:  app config "default_<type>"  = "yes" | "no"
 * User:   user config "default_<type>" = "yes" | "no" | "" (follow admin)
 */
class DefaultsService {
	/** type => mime types */
	public const TYPES = [
		'pdf' => ['application/pdf'],
		'png' => ['image/png'],
		'jpeg' => ['image/jpeg'],
	];

	/** defaults after a fresh install */
	private const FACTORY = ['pdf' => true, 'png' => false, 'jpeg' => false];

	public function __construct(
		private IAppConfig $appConfig,
		private IUserConfig $userConfig,
	) {
	}

	public static function isValidType(string $type): bool {
		return isset(self::TYPES[$type]);
	}

	/** @return array<string, bool> */
	public function getAdminDefaults(): array {
		$out = [];
		foreach (self::FACTORY as $type => $factory) {
			$v = $this->appConfig->getValueString(Application::APP_ID, 'default_' . $type, $factory ? 'yes' : 'no');
			$out[$type] = $v === 'yes';
		}
		return $out;
	}

	public function setAdminDefault(string $type, bool $enabled): void {
		$this->appConfig->setValueString(Application::APP_ID, 'default_' . $type, $enabled ? 'yes' : 'no');
	}

	/** @return array<string, string> "yes" | "no" | "" */
	public function getUserChoices(string $userId): array {
		$out = [];
		foreach (array_keys(self::TYPES) as $type) {
			$v = $this->userConfig->getValueString($userId, Application::APP_ID, 'default_' . $type, '');
			$out[$type] = in_array($v, ['yes', 'no'], true) ? $v : '';
		}
		return $out;
	}

	public function setUserChoice(string $userId, string $type, string $value): void {
		if ($value === '') {
			$this->userConfig->deleteUserConfig($userId, Application::APP_ID, 'default_' . $type);
			return;
		}
		$this->userConfig->setValueString($userId, Application::APP_ID, 'default_' . $type, $value);
	}

	/**
	 * Mime types that should open in Zeichenbrett for this user.
	 *
	 * @return list<string>
	 */
	public function getEffectiveMimes(?string $userId): array {
		$admin = $this->getAdminDefaults();
		$user = $userId !== null ? $this->getUserChoices($userId) : [];
		$mimes = [];
		foreach (self::TYPES as $type => $typeMimes) {
			$choice = $user[$type] ?? '';
			$on = $choice === '' ? $admin[$type] : $choice === 'yes';
			if ($on) {
				array_push($mimes, ...$typeMimes);
			}
		}
		return $mimes;
	}
}
