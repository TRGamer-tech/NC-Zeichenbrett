// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// File access for the editor. Two implementations with the same interface:
//   DavIO    – inside the Files app (logged-in browser session, WebDAV)
//   DirectIO – page opened by the mobile apps through Nextcloud's Direct Editing
//              (no session: every request carries a token, see DirectController.php)
//
// save()/writeCopy() resolve to { status, ... } and never throw for HTTP errors, so the
// editor can handle conflicts (412) and "already exists" in one place.

import axios from '@nextcloud/axios'
import { emit } from '@nextcloud/event-bus'
import { generateUrl } from '@nextcloud/router'
import { t } from '../l10n.js'
import { davExists, davStat, uncachedUrl, statNode, joinUrl, davRootOf, pickFolder } from './dav.js'

const PERM_UPDATE = 2

/** Read a fetch response into a Uint8Array, reporting progress (0..1). */
async function readBody(res, onProgress) {
	const total = Number(res.headers.get('content-length')) || 0
	if (!res.body || !total) return new Uint8Array(await res.arrayBuffer())
	const chunks = []
	let got = 0
	const reader = res.body.getReader()
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		chunks.push(value)
		got += value.length
		onProgress?.(Math.min(1, got / total))
	}
	const out = new Uint8Array(got)
	let o = 0
	for (const c of chunks) { out.set(c, o); o += c.length }
	return out
}

export class DavIO {
	constructor(node) {
		this.kind = 'dav'
		// encodedSource: names with %, # or ? would otherwise break the request URL
		this.url = node.encodedSource || node.source
		this.name = node.basename
		this.mime = node.mime
		this.etag = null
		this.canWrite = typeof node.permissions !== 'number' || (node.permissions & PERM_UPDATE) !== 0
		this.canPickFolder = true
		this.folder = this.url.slice(0, this.url.lastIndexOf('/') + 1)
	}

	async load(onProgress) {
		const res = await fetch(uncachedUrl(this.url), {
			cache: 'no-store',
			credentials: 'same-origin',
			headers: { requesttoken: window.OC?.requestToken || document.head.dataset.requesttoken || '' },
		})
		if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { where: decodeURIComponent(new URL(this.url, location.href).pathname) })
		this.etag = res.headers.get('etag')
		return readBody(res, onProgress)
	}

	async save(bytes, mime, force = false) {
		const headers = { 'Content-Type': mime }
		if (this.etag && !force) headers['If-Match'] = this.etag
		const res = await axios.put(this.url, bytes, { headers, validateStatus: () => true })
		if (res.status < 300) {
			this.etag = res.headers?.etag || res.headers?.['oc-etag'] || null
			this.notify('files:node:updated', this.url)
		}
		return { status: res.status }
	}

	folderLabel() {
		return decodeURIComponent(this.folder.slice(davRootOf(this.url).length)) || '/'
	}

	async pickFolder() {
		const picked = await pickFolder(davRootOf(this.url), this.folder)
		if (picked) this.folder = picked
		return !!picked
	}

	exists(name) {
		return davExists(joinUrl(this.folder, name))
	}

	isSelf(name) {
		return joinUrl(this.folder, name) === this.url
	}

	async writeCopy(name, bytes, mime, overwrite) {
		const url = joinUrl(this.folder, name)
		if (!overwrite && await davExists(url)) return { status: 409 }
		const res = await axios.put(url, bytes, { headers: { 'Content-Type': mime }, validateStatus: () => true })
		if (res.status >= 300) return { status: res.status }
		this.notify('files:node:created', url)
		const copy = new DavIO({ source: url, basename: name, mime, permissions: 31 })
		copy.etag = (await davStat(url))?.etag || null
		return { status: res.status, io: copy }
	}

	async notify(event, url) {
		try {
			const node = await statNode(url)
			if (node) emit(event, node)
		} catch (e) {
			console.debug('[zeichenbrett] Files-Liste nicht aktualisiert', e)
		}
	}

	closed() {}
}

export class DirectIO {
	/** @param {{token:string, name:string, mime:string, canWrite:boolean, canCreate:boolean}} state */
	constructor(state) {
		this.kind = 'direct'
		this.token = state.token
		this.name = state.name
		this.mime = state.mime
		this.etag = null
		this.canWrite = state.canWrite
		this.canCreate = state.canCreate !== false
		this.canPickFolder = false
		this.base = generateUrl('/apps/zeichenbrett/direct/')
	}

	request(path, init = {}) {
		return fetch(this.base + path, {
			cache: 'no-store',
			credentials: 'omit',
			...init,
			headers: { 'X-Zeichenbrett-Token': this.token, ...(init.headers || {}) },
		})
	}

	async load(onProgress) {
		const res = await this.request('file')
		if (!res.ok) throw new Error('HTTP ' + res.status)
		this.etag = res.headers.get('etag')
		return readBody(res, onProgress)
	}

	async save(bytes, mime, force = false) {
		const headers = { 'Content-Type': mime }
		if (this.etag && !force) headers['If-Match'] = this.etag
		const res = await this.request('file' + (force ? '?force=1' : ''), { method: 'PUT', headers, body: bytes })
		if (res.ok) this.etag = '"' + (await res.json()).etag + '"'
		return { status: res.status }
	}

	folderLabel() { return '' }

	async exists(name) {
		const res = await this.request('exists?name=' + encodeURIComponent(name))
		if (!res.ok) throw new Error('HTTP ' + res.status)
		return (await res.json()).exists
	}

	isSelf(name) {
		return name === this.name
	}

	async writeCopy(name, bytes, mime, overwrite) {
		const q = 'copy?name=' + encodeURIComponent(name) + (overwrite ? '&overwrite=1' : '')
		const res = await this.request(q, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes })
		if (!res.ok) return { status: res.status }
		const data = await res.json()
		const copy = new DirectIO({ token: data.token, name: data.name, mime: data.mime, canWrite: true, canCreate: this.canCreate })
		copy.etag = '"' + data.etag + '"'
		return { status: res.status, io: copy }
	}

	/** Tell the mobile app that the editor is ready / closed (Android: DirectEditingMobileInterface) */
	loaded() {
		try { window.DirectEditingMobileInterface?.loaded?.() } catch (e) { /* not in the app */ }
		try { window.webkit?.messageHandlers?.DirectEditingMobileInterface?.postMessage('loaded') } catch (e) { /* not iOS */ }
	}

	closed() {
		let handled = false
		const done = () => {
			if (handled) return
			// opened in a normal browser: there is no app to return to
			const box = document.createElement('div')
			box.style.cssText = 'padding:24px;font:16px system-ui,sans-serif'
			box.textContent = t('You can close this window now.')
			document.body.append(box)
		}
		try { if (window.DirectEditingMobileInterface?.close) { window.DirectEditingMobileInterface.close(); handled = true } } catch (e) { /* ignore */ }
		try { if (window.webkit?.messageHandlers?.DirectEditingMobileInterface) { window.webkit.messageHandlers.DirectEditingMobileInterface.postMessage('close'); handled = true } } catch (e) { /* ignore */ }
		done()
		return handled
	}
}
