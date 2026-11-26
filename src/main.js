// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Bootstrap script loaded into the Files app. Registers the file actions and
// lazy-loads the (large) editor bundle on first use.

import { registerFileAction } from '@nextcloud/files'
import { loadState } from '@nextcloud/initial-state'
import { generateFilePath } from '@nextcloud/router'
import { t } from './l10n.js'

const APP_ID = 'zeichenbrett'

export const SUPPORTED_MIMES = [
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'image/bmp',
]

// mime types the admin / user chose to open in Zeichenbrett on click
const DEFAULT_MIMES = (() => {
	try { return loadState(APP_ID, 'default-mimes', []) } catch (e) { return [] }
})()

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'

let editorPromise = null
function loadEditor() {
	if (!editorPromise) {
		const base = generateFilePath(APP_ID, '', 'js/')
		editorPromise = import(/* @vite-ignore */ base + 'zeichenbrett-editor.js')
			.catch((e) => { editorPromise = null; throw e })
	}
	return editorPromise
}

// The Files API changed from positional arguments (Nextcloud <= 32, @nextcloud/files v3)
// to a context object (Nextcloud >= 33, v4). Accept both.
function ctxOf(args) {
	const [a, b, c] = args
	if (Array.isArray(a)) return { nodes: a, view: b, dir: c }
	if (a && Array.isArray(a.nodes)) return { nodes: a.nodes, view: a.view, dir: a.folder?.path }
	if (a && a.source) return { nodes: [a], view: b, dir: c }
	return { nodes: [] }
}

const READ = 1
function isSupported(node) {
	if (!node || node.type === 'folder') return false
	if (!SUPPORTED_MIMES.includes(node.mime)) return false
	if (typeof node.permissions === 'number' && (node.permissions & READ) === 0) return false
	// only files of the user's own storage (not public shares, not other DAV roots)
	if (node.root && !String(node.root).startsWith('/files/')) return false
	return true
}

function enabledFor(args, extra = () => true) {
	const { nodes, view } = ctxOf(args)
	if (view && view.id === 'trashbin') return false
	return nodes.length === 1 && isSupported(nodes[0]) && extra(nodes[0])
}

async function exec(...args) {
	const { nodes } = ctxOf(args)
	try {
		const mod = await loadEditor()
		mod.openEditor(nodes[0])
	} catch (e) {
		console.error('[zeichenbrett] Editor konnte nicht geladen werden', e)
		window.alert(t('Zeichenbrett could not be loaded: {error}', { error: e?.message || String(e) }))
	}
	return null
}

const actions = [
	// entry in the "…" menu, always available
	{
		id: 'zeichenbrett-edit',
		displayName: () => t('Draw & annotate'),
		title: () => t('Open in Zeichenbrett'),
		iconSvgInline: () => ICON,
		enabled: (...args) => enabledFor(args),
		exec,
		order: 25,
	},
	// hidden default action: what happens when the file name is clicked.
	// The Viewer (and thereby files_pdfviewer) registers its default action without
	// an order (= 0). Files picks the FIRST enabled default action after sorting by
	// order, so a very low order makes Zeichenbrett win.
	{
		id: 'zeichenbrett-default',
		displayName: () => t('Open in Zeichenbrett'),
		iconSvgInline: () => ICON,
		enabled: (...args) => enabledFor(args, (node) => DEFAULT_MIMES.includes(node.mime)),
		exec,
		default: 'hidden',
		order: -10000,
	},
]

function ncMajor() {
	const v = window.OC?.config?.version || ''
	return parseInt(v.split('.')[0], 10) || 0
}

for (const action of actions) {
	try {
		if (ncMajor() && ncMajor() <= 32) {
			// legacy registry used by @nextcloud/files v3
			window._nc_fileactions ??= []
			if (!window._nc_fileactions.find((a) => a.id === action.id)) window._nc_fileactions.push(action)
		} else {
			registerFileAction(action)
		}
	} catch (e) {
		console.error('[zeichenbrett] Dateiaktion konnte nicht registriert werden', action.id, e)
	}
}

window.OCA = window.OCA || {}
window.OCA.Zeichenbrett = { open: (node) => loadEditor().then((m) => m.openEditor(node)) }
