// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Editor shell: one toolbar, pen / marker / eraser, save, save as copy.

import { generateFilePath } from '@nextcloud/router'
import css from './editor.css'
import { ICONS } from './icons.js'
import { Model } from './model.js'
import { Viewer } from './viewer.js'
import { Tools, TOOLS } from './tools.js'
import { setPdfWorker, openPdf, exportPdf, pdfSource } from './pdfdoc.js'
import { openImage, exportImage, imageSource, renderBase, defaultImageState, cssFilter } from './imagedoc.js'
import { t } from '../l10n.js'
import { DavIO, DirectIO } from './io.js'

export { DirectIO }

const APP_ID = 'zeichenbrett'
const COLORS = ['#000000', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ffffff']
// thin / medium / thick, in screen pixels
const SIZES = {
	pen: { key: 'width', values: [2, 4, 8] },
	marker: { key: 'markerWidth', values: [10, 20, 36] },
	eraser: { key: 'eraserSize', values: [12, 30, 70] },
}
const SETTINGS_KEY = 'zeichenbrett.settings.v2'
const ABORTED = 'zeichenbrett-aborted'
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' }

let styleInjected = false
let current = null

function loadSettings() {
	const d = { tool: 'pen', color: '#e53935', width: 4, markerWidth: 20, eraserSize: 30, fingerMode: 'auto', penSeen: false }
	try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } } catch (e) { return d }
}
function storeSettings(s) {
	try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch (e) { /* private mode */ }
}

function h(tag, attrs = {}, ...children) {
	const e = document.createElement(tag)
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v === undefined || v === null || v === false) continue
		if (k === 'class') e.className = v
		else if (k === 'html') e.innerHTML = v
		else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
		else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v)
		else e.setAttribute(k, v === true ? '' : v)
	}
	for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c))
	return e
}

function iconBtn(icon, title, onclick, extra = {}) {
	const b = h('button', { type: 'button', class: 'zb-btn' + (extra.class ? ' ' + extra.class : ''), title, 'aria-label': title, onclick, html: ICONS[icon] })
	if (extra.label) b.append(h('span', {}, extra.label))
	return b
}

function splitName(name) {
	const i = name.lastIndexOf('.')
	return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, '']
}

/**
 * @param {object} node  Files app node (or { basename, mime } with opts.io)
 * @param {{ version?: string, io?: object, jsBase?: string }} opts
 */
export async function openEditor(node, { version = '', io = null, jsBase = '' } = {}) {
	if (current) return
	if (!styleInjected) {
		document.head.append(h('style', { id: 'zeichenbrett-style' }, css))
		styleInjected = true
	}
	const js = jsBase || generateFilePath(APP_ID, '', 'js/')
	setPdfWorker(js + 'pdf.worker.min.js?v=' + encodeURIComponent(version), js + 'pdfjs/')
	current = new Editor(node, io || new DavIO(node))
	try {
		await current.init()
	} catch (e) {
		console.error('[zeichenbrett]', e)
		current?.fail(e)
	}
}

class Editor {
	constructor(node, io) {
		this.settings = loadSettings()
		if (!TOOLS[this.settings.tool]) this.settings.tool = 'pen'
		this.io = io
		this.isPdf = io.mime === 'application/pdf'
		this.model = new Model()
		this.root = h('div', { class: 'zb-root', role: 'dialog', 'aria-label': 'Zeichenbrett' })
		this.loading = h('div', { class: 'zb-loading' }, h('div', { class: 'zb-spinner' }), h('div', { class: 'zb-loading-text' }, t('Loading {name} …', { name: node.basename })))
		this.root.append(this.loading)
		document.body.append(this.root)
		document.body.classList.add('zb-open')
		this._key = (e) => this.onKey(e)
		this._keyUp = (e) => { if (e.key === ' ' && this.tools) { this.tools.spaceDown = false; this.tools.updateCursor() } }
		this._unload = (e) => { if (this.model.dirty) { e.preventDefault(); e.returnValue = '' } }
		window.addEventListener('keydown', this._key, true)
		window.addEventListener('keyup', this._keyUp, true)
		window.addEventListener('beforeunload', this._unload)
	}

	setLoading(text) {
		const el = this.loading.querySelector('.zb-loading-text')
		if (el) el.textContent = text
	}

	async init() {
		let bytes
		try {
			bytes = await this.io.load((f) => this.setLoading(t('Loading {name} … {percent} %', { name: this.io.name, percent: Math.round(f * 100) })))
		} catch (e) {
			throw new Error(t('Loading failed: {reason}', { reason: e.message }) + (e.where ? ' (' + e.where + ')' : ''))
		}

		if (this.isPdf) {
			this.pdf = await openPdf(bytes)
			if (this.pdf.layersJson) this.model.load(this.pdf.layersJson)
			this.source = pdfSource(this.pdf)
		} else {
			this.img = await openImage(bytes, this.io.mime)
			if (this.img.layersJson) this.model.load(this.img.layersJson)
			if (!this.model.extra || !Array.isArray(this.model.extra.orient)) this.model.extra = defaultImageState(this.img.baseMime)
			const base = renderBase(this.img.bitmap, this.model.extra)
			this.source = imageSource(() => base, () => cssFilter(this.model.extra?.adjust))
		}
		// draw into the top-most layer
		this.model.activeId = this.model.layers[this.model.layers.length - 1].id
		this.buildUI()
		this.loading.remove()
		this.io.loaded?.()
	}

	fail(e) {
		this.loading.innerHTML = ''
		this.loading.append(h('div', { class: 'zb-error' },
			h('strong', {}, t('The file could not be opened.')),
			h('div', {}, String(e?.message || e)),
			h('button', { class: 'zb-btn zb-primary', onclick: () => this.destroy() }, t('Close'))))
	}

	// ================================================================== UI
	buildUI() {
		const s = this.settings
		this.toolButtons = {}
		this.fingerBtn = null
		if (navigator.maxTouchPoints > 0) {
			this.fingerLabel = h('span', { class: 'zb-keep' })
			this.fingerBtn = iconBtn('pan', '', () => {
				this.settings.fingerMode = this.tools.fingerDraws() ? 'scroll' : 'draw'
				storeSettings(this.settings)
				this.updateFingerUI()
				this.toast(this.tools.fingerDraws() ? t('Your finger draws.') : t('Your finger scrolls and zooms, only the pen draws.'))
			})
			this.fingerBtn.classList.add('zb-penmode')
			this.fingerBtn.append(this.fingerLabel)
		}
		const tools = h('div', { class: 'zb-group' }, Object.keys(TOOLS).map((tool) => {
			const b = iconBtn(tool, `${TOOLS[tool].label()} (${TOOLS[tool].key.toUpperCase()})`, () => this.setTool(tool))
			this.toolButtons[tool] = b
			// finger mode switch sits right next to the pen
			return tool === 'pen' && this.fingerBtn ? [b, this.fingerBtn] : b
		}).flat())

		this.colorInput = h('input', { type: 'color', value: s.color, title: t('Custom color'), class: 'zb-colorinput' })
		this.colorInput.addEventListener('input', () => this.setColor(this.colorInput.value))
		this.swatches = COLORS.map((c) => h('button', {
			type: 'button', class: 'zb-swatch', title: c, style: { background: c }, 'data-color': c, onclick: () => this.setColor(c),
		}))
		const colors = h('div', { class: 'zb-group zb-colors' }, this.swatches, this.colorInput)

		this.sizeButtons = [0, 1, 2].map((i) => h('button', {
			type: 'button', class: 'zb-btn zb-sizebtn', title: [t('Thin'), t('Medium'), t('Thick')][i], onclick: () => this.setSize(i),
		}, h('span', { class: 'zb-dot', style: { width: 4 + i * 5 + 'px', height: 4 + i * 5 + 'px' } })))
		const sizes = h('div', { class: 'zb-group' }, this.sizeButtons)

		// touch devices: switch between "finger draws" and "finger scrolls (only the pen draws)"


		this.undoBtn = iconBtn('undo', t('Undo (Ctrl+Z)'), () => this.model.undo())
		this.redoBtn = iconBtn('redo', t('Redo (Ctrl+Y)'), () => this.model.redo())
		this.zoomLabel = h('button', { type: 'button', class: 'zb-btn zb-zoomlabel', title: t('Fit to width (0)'), onclick: () => this.viewer.fit('width') }, '100 %')

		this.dirtyDot = h('span', { class: 'zb-dirty', title: t('Unsaved changes') })
		this.nameEl = h('span', { class: 'zb-name' }, this.io.name)
		this.pageLabel = this.isPdf && this.source.count > 1 ? h('span', { class: 'zb-pagelabel' }) : null

		const bar = h('header', { class: 'zb-top' },
			h('div', { class: 'zb-title' }, this.dirtyDot, this.nameEl, this.pageLabel),
			tools, colors, sizes,
			h('div', { class: 'zb-group' }, this.undoBtn, this.redoBtn),
			h('div', { class: 'zb-group zb-zoomgroup' },
				iconBtn('zoomOut', t('Zoom out (-)'), () => this.viewer.zoomBy(1 / 1.25)),
				this.zoomLabel,
				iconBtn('zoomIn', t('Zoom in (+)'), () => this.viewer.zoomBy(1.25))),
			h('div', { class: 'zb-spacer' }),
			h('div', { class: 'zb-group' },
				iconBtn('save', t('Save (Ctrl+S)'), () => this.save(), { class: 'zb-primary', label: t('Save') }),
				iconBtn('copy', t('Save as copy (Ctrl+Shift+S)'), () => this.saveCopy(), { label: t('Copy') }),
				iconBtn('close', t('Close (Esc)'), () => this.close())))

		this.stage = h('div', { class: 'zb-stage' })
		this.toastEl = h('div', { class: 'zb-toast', role: 'status' })
		this.root.append(bar, this.stage, this.toastEl)

		this.viewer = new Viewer(this.stage, this.source, this.model)
		if (Array.isArray(window.__zbStats)) { window.__zbModel = this.model; window.__zbSource = this.source } // test hooks
		this.viewer.onZoom = (sc) => { this.zoomLabel.textContent = Math.round(sc * 100) + ' %' }
		this.tools = new Tools(this.viewer, this.model, s, {
			onPenDetected: () => {
				storeSettings(this.settings)
				this.updateFingerUI()
				if (this.settings.fingerMode === 'auto') this.toast(t('Pen detected: your finger now scrolls and zooms, only the pen draws.'), 5000)
			},
		})
		if (this.pageLabel) this.viewer.scroller.addEventListener('scroll', () => this.updatePageLabel(), { passive: true })
		this.model.onChange(() => this.updateState())
		this.setTool(s.tool)
		this.setColor(s.color)
		this.updateFingerUI()
		this.updateState()
		this.updatePageLabel()
	}

	updateFingerUI() {
		if (!this.fingerBtn) return
		const penMode = !this.tools.fingerDraws()
		this.fingerBtn.classList.toggle('zb-active', penMode)
		this.fingerLabel.textContent = penMode ? t('Pen mode: on') : t('Pen mode: off')
		const title = penMode
			? t('Pen mode is on: only the pen draws, your finger scrolls and zooms. Tap to turn it off.')
			: t('Pen mode is off: your finger draws. Tap so that only the pen draws.')
		this.fingerBtn.title = title
		this.fingerBtn.setAttribute('aria-label', title)
		this.fingerBtn.setAttribute('aria-pressed', String(penMode))
	}

	updatePageLabel() {
		if (this.pageLabel) this.pageLabel.textContent = `${this.viewer.currentPage() + 1} / ${this.source.count}`
	}

	setTool(t) {
		this.settings.tool = t
		this.tools.setTool(t)
		for (const [k, b] of Object.entries(this.toolButtons)) b.classList.toggle('zb-active', k === t)
		this.updateSizeUI()
		storeSettings(this.settings)
	}

	setColor(c) {
		this.settings.color = c
		this.colorInput.value = c
		for (const sw of this.swatches) sw.classList.toggle('zb-active', sw.dataset.color.toLowerCase() === c.toLowerCase())
		if (this.settings.tool === 'eraser') this.setTool('pen')
		this.updateSizeUI()
		storeSettings(this.settings)
	}

	setSize(i) {
		const { key, values } = SIZES[this.settings.tool]
		this.settings[key] = values[i]
		this.updateSizeUI()
		storeSettings(this.settings)
	}

	updateSizeUI() {
		const tool = this.settings.tool
		const { key, values } = SIZES[tool]
		const cur = this.settings[key]
		let best = 0
		values.forEach((v, i) => { if (Math.abs(v - cur) < Math.abs(values[best] - cur)) best = i })
		this.sizeButtons.forEach((b, i) => {
			b.classList.toggle('zb-active', i === best)
			const dot = b.firstChild
			dot.style.background = tool === 'eraser' ? 'transparent' : this.settings.color
			dot.style.opacity = tool === 'marker' ? 0.5 : 1
		})
	}

	updateState() {
		this.undoBtn.disabled = !this.model.undoStack.length
		this.redoBtn.disabled = !this.model.redoStack.length
		this.dirtyDot.classList.toggle('zb-on', this.model.dirty)
	}

	toast(msg, ms = 3500) {
		this.toastEl.textContent = msg
		this.toastEl.classList.add('zb-show')
		clearTimeout(this._toastT)
		this._toastT = setTimeout(() => this.toastEl.classList.remove('zb-show'), ms)
	}

	// ============================================================ keyboard
	onKey(e) {
		if (!this.viewer) {
			if (e.key === 'Escape') this.destroy()
			return
		}
		if (document.querySelector('.zb-modal')) return
		const tag = e.target?.tagName
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
		e.stopPropagation()
		const mod = e.ctrlKey || e.metaKey
		const k = e.key.toLowerCase()
		if (mod && k === 's') { e.preventDefault(); if (e.shiftKey) this.saveCopy(); else this.save(); return }
		if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.model.redo(); else this.model.undo(); return }
		if (mod && k === 'y') { e.preventDefault(); this.model.redo(); return }
		if (mod) return
		if (e.key === ' ') { e.preventDefault(); this.tools.spaceDown = true; this.tools.updateCursor(); return }
		if (e.key === 'Escape') { this.close(); return }
		if (e.key === '+' || e.key === '=') { this.viewer.zoomBy(1.25); return }
		if (e.key === '-') { this.viewer.zoomBy(1 / 1.25); return }
		if (e.key === '0') { this.viewer.fit('width'); return }
		if (e.key === 'PageDown' || e.key === 'PageUp') {
			e.preventDefault()
			const p = this.viewer.currentPage() + (e.key === 'PageDown' ? 1 : -1)
			this.viewer.scrollToPage(Math.max(0, Math.min(this.source.count - 1, p)))
			return
		}
		const hit = Object.entries(TOOLS).find(([, v]) => v.key === k)
		if (hit) this.setTool(hit[0])
		if (k >= '1' && k <= '3') this.setSize(Number(k) - 1)
	}

	// ============================================================== saving
	async buildFile(format) {
		if (this.isPdf) {
			try {
				return { bytes: await exportPdf(this.pdf.cleanBytes, this.model, { editable: true }), mime: 'application/pdf' }
			} catch (e) {
				if (/encrypted/i.test(e?.message || '')) throw new Error(t('This PDF is encrypted (password or permission protection) and cannot be saved.'))
				throw e
			}
		}
		return exportImage({ bitmap: this.img.bitmap, baseBytes: this.img.baseBytes, model: this.model, format, editable: true })
	}

	imageFormatFor(mime) {
		return ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : 'image/png'
	}

	async save() {
		if (this.busy) return
		if (!this.io.canWrite) {
			this.toast(t('You are not allowed to change this file, please save a copy.'))
			return this.saveCopy()
		}
		const format = this.isPdf ? 'application/pdf' : this.imageFormatFor(this.io.mime)
		if (!this.isPdf && format !== this.io.mime) return this.saveCopy()
		await this.withBusy(t('Saving …'), async () => {
			const { bytes, mime } = await this.buildFile(format)
			let { status } = await this.io.save(bytes, mime)
			if (status === 412) {
				if (!confirm(t('The file was changed by someone else in the meantime. Overwrite it anyway?') + '\n\n' + t('Cancel and use "Copy" to keep both versions.'))) {
					throw new Error(ABORTED)
				}
				status = (await this.io.save(bytes, mime, true)).status
			}
			checkStatus(status)
			this.model.dirty = false
			this.updateState()
			this.toast(t('Saved'))
		})
	}

	async withBusy(text, fn) {
		this.busy = true
		const ov = h('div', { class: 'zb-busy' }, h('div', { class: 'zb-spinner' }), h('div', {}, text))
		this.root.append(ov)
		try {
			await fn()
		} catch (e) {
			console.error('[zeichenbrett]', e)
			if (e?.message !== ABORTED) alert(e?.message || String(e))
		} finally {
			ov.remove()
			this.busy = false
		}
	}

	async saveCopy() {
		if (this.busy || document.querySelector('.zb-modal')) return
		const io = this.io
		const [base0, ext0] = splitName(io.name)
		const edited = t('edited')
		const base = base0.replace(new RegExp(' \\(' + edited.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( \\d+)?\\)$'), '')
		const format = this.isPdf ? 'application/pdf' : this.imageFormatFor(io.mime)
		const ext = format === io.mime && ext0 ? ext0 : EXT[format]
		let suggested = `${base} (${edited}).${ext}`
		for (let i = 2; i < 100 && await io.exists(suggested); i++) suggested = `${base} (${edited} ${i}).${ext}`

		const nameInput = h('input', { type: 'text', class: 'zb-input', value: suggested })
		const fields = [h('label', { class: 'zb-field' }, h('span', {}, t('File name')), nameInput)]
		if (io.canPickFolder) {
			const folderLabel = h('span', { class: 'zb-folder' }, io.folderLabel())
			fields.push(h('div', { class: 'zb-field' }, h('span', {}, t('Folder')), h('div', { class: 'zb-inline' }, folderLabel,
				h('button', {
					type: 'button', class: 'zb-btn', onclick: async () => {
						if (await io.pickFolder()) folderLabel.textContent = io.folderLabel()
					},
				}, t('Change …')))))
		}
		const ok = await modal(t('Save as copy'), fields, [
			{ label: t('Cancel'), value: null },
			{ label: t('Save'), value: true, primary: true },
		], () => { nameInput.focus(); nameInput.setSelectionRange(0, nameInput.value.lastIndexOf('.')) })
		if (!ok) return
		const name = nameInput.value.trim().replace(/[/\\]/g, '_')
		if (!name) return
		if (io.isSelf(name)) return this.save()
		let overwrite = false
		if (await io.exists(name)) {
			if (!confirm(t('"{name}" already exists. Overwrite it?', { name }))) return
			overwrite = true
		}
		await this.withBusy(t('Saving copy …'), async () => {
			const { bytes, mime } = await this.buildFile(format)
			const res = await io.writeCopy(name, bytes, mime, overwrite)
			checkStatus(res.status)
			// from now on Ctrl+S saves into the copy, the original stays untouched
			this.io = res.io
			this.nameEl.textContent = this.io.name
			this.model.dirty = false
			this.updateState()
			this.toast(t('Copy saved: {name}', { name: this.io.name }))
		})
	}

	// ============================================================== closing
	async close() {
		if (this.busy) return
		if (this.model.dirty) {
			const r = await modal(t('Unsaved changes'), [h('p', {}, t('Do you want to save your changes?'))], [
				{ label: t('Discard'), value: 'discard' },
				{ label: t('Cancel'), value: null },
				{ label: t('Save'), value: 'save', primary: true },
			])
			if (!r) return
			if (r === 'save') { await this.save(); if (this.model.dirty) return }
		}
		this.destroy()
	}

	destroy() {
		window.removeEventListener('keydown', this._key, true)
		window.removeEventListener('keyup', this._keyUp, true)
		window.removeEventListener('beforeunload', this._unload)
		try { this.viewer?.destroy() } catch (e) { /* ignore */ }
		try { this.pdf?.pdf?.destroy() } catch (e) { /* ignore */ }
		this.root.remove()
		document.body.classList.remove('zb-open')
		current = null
		this.io.closed?.()
	}
}

function checkStatus(status) {
	if (status < 300) return
	const reason = status === 403 ? t('No permission')
		: status === 507 ? t('Not enough storage space')
			: status === 423 ? t('The file is locked')
				: status === 409 ? t('A file with this name already exists.')
					: 'HTTP ' + status
	throw new Error(t('Saving failed: {reason}', { reason }))
}

/** Minimal promise-based modal dialog */
export function modal(title, body, buttons, onOpen) {
	return new Promise((resolve) => {
		const close = (v) => { wrap.remove(); resolve(v) }
		const wrap = h('div', { class: 'zb-modal' },
			h('div', { class: 'zb-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
				h('h2', {}, title),
				h('div', { class: 'zb-dialog-body' }, body),
				h('div', { class: 'zb-dialog-buttons' }, buttons.map((b) => h('button', {
					type: 'button', class: 'zb-btn' + (b.primary ? ' zb-primary' : ''), onclick: () => close(b.value),
				}, b.label)))))
		wrap.addEventListener('keydown', (e) => {
			e.stopPropagation()
			if (e.key === 'Escape') close(null)
			if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
				const p = buttons.find((b) => b.primary)
				if (p) { e.preventDefault(); close(p.value) }
			}
		})
		wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(null) })
		;(document.querySelector('.zb-root') || document.body).append(wrap)
		onOpen?.()
	})
}
