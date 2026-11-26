// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Tiny WebDAV helpers + a folder picker that works on every Nextcloud version
// (no dependency on the Vue based @nextcloud/dialogs picker).

import axios from '@nextcloud/axios'
import { getClient, resultToNode, getDefaultPropfind } from '@nextcloud/files/dav'
import { modal } from './index.js'
import { t } from '../l10n.js'

export function davRootOf(url) {
	const m = /^(.*\/remote\.php\/dav\/files\/[^/]+\/)/.exec(url)
	return m ? m[1] : url.slice(0, url.lastIndexOf('/') + 1)
}

export function joinUrl(folderUrl, name) {
	return folderUrl.replace(/\/?$/, '/') + encodeURIComponent(name)
}

const requesttoken = () => window.OC?.requestToken || document.head.dataset.requesttoken || ''

/**
 * Existence / etag lookup with PROPFIND. Deliberately not HEAD or GET: Nextcloud sends no
 * Cache-Control for WebDAV files, so browsers, reverse proxies and CDNs (which cache
 * .pdf/.png/.jpg URLs and even 404 answers) could answer from a cache. PROPFIND is
 * never cached. Returns null if the file does not exist.
 */
export async function davStat(url) {
	const res = await fetch(url, {
		method: 'PROPFIND',
		cache: 'no-store',
		credentials: 'same-origin',
		headers: { Depth: '0', 'Content-Type': 'application/xml', requesttoken: requesttoken() },
		body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>',
	})
	if (res.status === 404) return null
	if (!res.ok) throw new Error('HTTP ' + res.status)
	const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')
	return { etag: doc.getElementsByTagNameNS('DAV:', 'getetag')[0]?.textContent || null }
}

export async function davExists(url) {
	return (await davStat(url)) !== null
}

/** URL for downloading a file that no cache on the way can answer */
export function uncachedUrl(url) {
	return url + (url.includes('?') ? '&' : '?') + 'zb=' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** Build a Files-app Node for a DAV URL (used to refresh the file list). */
export async function statNode(url) {
	const path = decodeURIComponent(new URL(url, location.href).pathname.split('/remote.php/dav')[1] || '')
	if (!path) return null
	const client = getClient()
	const stat = await client.stat(path, { details: true, data: getDefaultPropfind() })
	return resultToNode(stat.data)
}

async function listFolders(url) {
	const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>'
	const res = await axios.request({ method: 'PROPFIND', url, data: body, headers: { Depth: '1', 'Content-Type': 'application/xml' } })
	const doc = new DOMParser().parseFromString(res.data, 'application/xml')
	const out = []
	const self = new URL(url, location.href).pathname.replace(/\/?$/, '/')
	for (const r of doc.getElementsByTagNameNS('DAV:', 'response')) {
		const href = r.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent || ''
		const isDir = r.getElementsByTagNameNS('DAV:', 'collection').length > 0
		const path = href.replace(/\/?$/, '/')
		if (!isDir || path === self) continue
		const name = decodeURIComponent(path.slice(0, -1).split('/').pop())
		if (name.startsWith('.')) continue
		out.push({ name, url: new URL(path, location.href).href })
	}
	return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** Resolves with the chosen folder URL (ending with "/") or null */
export async function pickFolder(rootUrl, startUrl) {
	let cur = startUrl
	const pathEl = document.createElement('div')
	pathEl.className = 'zb-pickpath'
	const list = document.createElement('ul')
	list.className = 'zb-picklist'
	const render = async () => {
		pathEl.textContent = '/' + decodeURIComponent(cur.slice(rootUrl.length))
		list.innerHTML = ''
		list.append(hint(t('Loading …')))
		let folders = []
		try { folders = await listFolders(cur) } catch (e) { list.innerHTML = ''; list.append(hint(t('Could not load the folder'))); return }
		list.innerHTML = ''
		if (cur.length > rootUrl.length) {
			const up = cur.slice(0, cur.slice(0, -1).lastIndexOf('/') + 1)
			list.append(item('⬑ ' + t('Parent folder'), up))
		}
		for (const f of folders) list.append(item('📁 ' + f.name, f.url))
		if (!folders.length) list.append(hint(t('No subfolders')))
	}
	const hint = (text) => Object.assign(document.createElement('li'), { className: 'zb-hint', textContent: text })
	const item = (label, url) => {
		const li = document.createElement('li')
		const b = document.createElement('button')
		b.type = 'button'
		b.className = 'zb-pickitem'
		b.textContent = label
		b.onclick = () => { cur = url; render() }
		li.append(b)
		return li
	}
	render()
	const r = await modal(t('Choose folder'), [pathEl, list], [
		{ label: t('Cancel'), value: null },
		{ label: t('Choose this folder'), value: 'ok', primary: true },
	])
	return r ? cur : null
}
