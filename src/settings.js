// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Admin + personal settings: changes are saved with the "Save" button.
import { t } from './l10n.js'

function valueOf(el) {
	return el.type === 'checkbox' ? el.checked : el.value
}

function init(root) {
	const scope = root.dataset.scope
	const status = root.querySelector('.zeichenbrett-status')
	const button = root.querySelector('.zeichenbrett-save')
	const fields = [...root.querySelectorAll('[data-type]')]
	let saved = new Map(fields.map((f) => [f, valueOf(f)]))

	const changed = () => fields.filter((f) => valueOf(f) !== saved.get(f))
	const show = (text, kind) => {
		status.textContent = text
		status.classList.toggle('success', kind === 'ok')
		status.classList.toggle('error', kind === 'error')
	}
	const update = () => {
		const dirty = changed().length > 0
		button.disabled = !dirty
		if (dirty) show(t('Unsaved changes'), '')
		else if (status.textContent === t('Unsaved changes')) show('', '')
	}

	root.addEventListener('change', update)
	button.addEventListener('click', async () => {
		button.disabled = true
		try {
			for (const el of changed()) {
				const type = el.dataset.type
				const data = scope === 'admin' ? { type, enabled: el.checked } : { type, value: el.value }
				const res = await fetch(window.OC.generateUrl('/apps/zeichenbrett/settings/' + scope), {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						requesttoken: window.OC.requestToken || document.head.dataset.requesttoken || '',
					},
					body: JSON.stringify(data),
				})
				if (!res.ok) throw new Error('HTTP ' + res.status)
				saved.set(el, valueOf(el))
			}
			show(t('Saved'), 'ok')
		} catch (err) {
			console.error('[zeichenbrett]', err)
			show(t('Could not save the setting'), 'error')
		}
		update()
	})
	window.addEventListener('beforeunload', (e) => {
		if (changed().length) e.preventDefault()
	})
	saved = new Map(fields.map((f) => [f, valueOf(f)]))
}

function start() {
	document.querySelectorAll('.zeichenbrett-settings').forEach(init)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
