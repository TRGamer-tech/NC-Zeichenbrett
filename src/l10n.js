// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Minimal translation helper (no dependencies, keeps the Files bootstrap tiny).
// Nextcloud loads l10n/<lang>.js via Util::addTranslations(), which registers the
// strings in window._oc_l10n_registry_translations. Results are plain text: always
// insert them with textContent / attributes, never as HTML.

const APP = 'zeichenbrett'

export function t(text, vars) {
	const dict = window._oc_l10n_registry_translations?.[APP]
	let out = (dict && typeof dict[text] === 'string' && dict[text]) || text
	if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
	return out
}
