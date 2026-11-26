<?php

declare(strict_types=1);

// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Zeichenbrett\Service;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Security\ICrypto;

/**
 * Credentials for the editor page opened through Nextcloud's Direct Editing (mobile
 * apps). The one-time Direct Editing token only authorizes rendering the page; loading
 * and saving afterwards use these tokens.
 *
 * Format: base64url(json payload) "." base64url(HMAC-SHA512 with the instance secret).
 * Stateless, bound to one user and one file id, valid for a limited time.
 */
class DirectSessionService {
	public const TTL = 12 * 3600;

	public function __construct(
		private ICrypto $crypto,
		private ITimeFactory $time,
	) {
	}

	public function create(string $userId, int $fileId): string {
		$payload = self::b64(json_encode([
			'v' => 1,
			'u' => $userId,
			'f' => $fileId,
			'e' => $this->time->getTime() + self::TTL,
		], JSON_THROW_ON_ERROR));
		return $payload . '.' . self::b64($this->crypto->calculateHMAC('zeichenbrett-direct:' . $payload));
	}

	/**
	 * @return array{0: string, 1: int} user id and file id
	 * @throws InvalidTokenException
	 */
	public function verify(string $token): array {
		$parts = explode('.', $token);
		if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
			throw new InvalidTokenException();
		}
		$expected = self::b64($this->crypto->calculateHMAC('zeichenbrett-direct:' . $parts[0]));
		if (!hash_equals($expected, $parts[1])) {
			throw new InvalidTokenException();
		}
		$data = json_decode((string)base64_decode(strtr($parts[0], '-_', '+/'), true), true);
		if (!is_array($data) || ($data['v'] ?? null) !== 1 || !is_string($data['u'] ?? null) || !is_int($data['f'] ?? null) || !is_int($data['e'] ?? null)) {
			throw new InvalidTokenException();
		}
		if ($data['e'] < $this->time->getTime()) {
			throw new InvalidTokenException();
		}
		return [$data['u'], $data['f']];
	}

	private static function b64(string $raw): string {
		return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
	}
}
