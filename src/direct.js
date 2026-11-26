// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Entry point of the page the mobile apps open through Nextcloud's Direct Editing.
import { loadState } from '@nextcloud/initial-state'
import { t } from './l10n.js'

function showError(text) {
	const box = document.createElement('div')
	box.style.cssText = 'padding:24px;font:16px system-ui,sans-serif'
	box.textContent = text
	document.body.append(box)
}

let state = null
try {
	state = loadState('zeichenbrett', 'direct')
} catch (e) {
	showError(t('The file could not be opened.'))
}

if (state) {
	const v = encodeURIComponent(state.version || '')
	import(/* @vite-ignore */ state.jsBase + 'zeichenbrett-editor.js?v=' + v)
		.then((mod) => mod.openEditor({ basename: state.name, mime: state.mime }, {
			version: state.version,
			jsBase: state.jsBase,
			io: new mod.DirectIO(state),
		}))
		.catch((e) => {
			console.error('[zeichenbrett]', e)
			showError(t('Zeichenbrett could not be loaded: {error}', { error: e?.message || String(e) }))
		})
}
