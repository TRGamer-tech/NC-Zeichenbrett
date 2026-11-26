// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Admin + personal settings: save on change.
import { t } from './l10n.js'

function init(root) {
	const status = root.querySelector('.zeichenbrett-status')
	const scope = root.dataset.scope
	let timer = null
	const show = (text, ok) => {
		status.textContent = text
		status.classList.toggle('success', ok)
		status.classList.toggle('error', !ok)
		clearTimeout(timer)
		timer = setTimeout(() => { status.textContent = '' }, 2500)
	}
	root.addEventListener('change', async (e) => {
		const el = e.target
		const type = el.dataset?.type
		if (!type) return
		const data = scope === 'admin' ? { type, enabled: el.checked } : { type, value: el.value }
		try {
			const res = await fetch(window.OC.generateUrl('/apps/zeichenbrett/settings/' + scope), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					requesttoken: window.OC.requestToken || document.head.dataset.requesttoken || '',
				},
				body: JSON.stringify(data),
			})
			if (!res.ok) throw new Error('HTTP ' + res.status)
			show(t('Saved'), true)
		} catch (err) {
			console.error('[zeichenbrett]', err)
			show(t('Could not save the setting'), false)
		}
	})
}

function start() {
	document.querySelectorAll('.zeichenbrett-settings').forEach(init)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
