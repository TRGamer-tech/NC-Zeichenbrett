// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Editing one text field: a textarea placed exactly over the text on the page, plus a
// small bar with "Done" and "Delete". While it is open, the canvas hides that item.

import { uid } from './model.js'
import { measureText, FONT_FAMILY, LINE_HEIGHT } from './render.js'
import { ICONS } from './icons.js'
import { t } from '../l10n.js'

export class TextField {
	/**
	 * @param {object} o
	 * @param {import('./viewer.js').Viewer} o.viewer
	 * @param {import('./model.js').Model} o.model
	 * @param {HTMLElement} o.stage
	 * @param {object|null} o.item   existing text item, or null for a new one
	 * @param {{page:number,x:number,y:number}} o.at  document point for a new text
	 * @param {string} o.color
	 * @param {number} o.size  font size in document units (new text)
	 * @param {Function} o.onClose
	 */
	constructor({ viewer, model, stage, item, at, color, size, onClose }) {
		this.v = viewer
		this.model = model
		this.item = item
		this.onClose = onClose
		this.page = item ? item.page : at.page
		this.color = item ? item.color : color
		this.size = item ? item.size : size
		if (item) {
			this.origin = { x: item.x, y: item.y }
			this.axes = { ux: item.ux, uy: item.uy, vx: item.vx, vy: item.vy }
		} else {
			// the tap marks the middle of the first line
			this.axes = viewer.screenAxes(this.page)
			const up = this.size * LINE_HEIGHT / 2
			this.origin = { x: at.x - this.axes.vx * up, y: at.y - this.axes.vy * up }
		}

		this.ta = document.createElement('textarea')
		this.ta.className = 'zb-textedit'
		this.ta.rows = 1
		this.ta.value = item ? item.text : ''
		this.ta.placeholder = t('Type here …')
		this.ta.spellcheck = false
		this.ta.addEventListener('input', () => this.autosize())
		this.ta.addEventListener('keydown', (e) => {
			e.stopPropagation()
			if (e.key === 'Escape') { e.preventDefault(); this.close(false) }
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.close(true) }
		})
		// keep the page from scrolling / drawing when the field itself is used
		this.ta.addEventListener('pointerdown', (e) => e.stopPropagation())

		const btn = (icon, label, cls, fn) => {
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'zb-btn ' + cls
			b.innerHTML = ICONS[icon]
			const span = document.createElement('span')
			span.className = 'zb-keep'
			span.textContent = label
			b.append(span)
			b.addEventListener('pointerdown', (e) => e.stopPropagation())
			b.addEventListener('click', fn)
			return b
		}
		this.bar = document.createElement('div')
		this.bar.className = 'zb-textbar'
		this.bar.append(
			btn('check', t('Done'), 'zb-primary', () => this.close(true)),
			item ? btn('trash', t('Delete'), '', () => this.remove()) : btn('close', t('Cancel'), '', () => this.close(false)),
		)
		stage.append(this.ta, this.bar)
		if (item) viewer.hiddenItemId = item.id
		viewer.requestOverlay()
		this.position()
		this.autosize()
		this.ta.focus()
		this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length)
	}

	/** keep the field over the text when the page is scrolled or zoomed */
	position() {
		const stage = this.ta.parentElement?.getBoundingClientRect()
		if (!stage) return
		const [cx, cy] = this.v.docToClient(this.page, this.origin.x, this.origin.y)
		const px = this.size * this.v.scale
		Object.assign(this.ta.style, {
			left: (cx - stage.left) + 'px',
			top: (cy - stage.top) + 'px',
			font: `${px}px/${LINE_HEIGHT} ${FONT_FAMILY}`,
			color: this.color,
		})
		this.autosize()
	}

	autosize() {
		const ta = this.ta
		ta.style.height = 'auto'
		ta.style.height = ta.scrollHeight + 'px'
		ta.style.width = 'auto'
		ta.style.width = Math.max(this.size * this.v.scale * 2, ta.scrollWidth + 4) + 'px'
		const top = parseFloat(ta.style.top) || 0
		const left = parseFloat(ta.style.left) || 0
		Object.assign(this.bar.style, { left: left + 'px', top: (top + ta.offsetHeight + 6) + 'px' })
	}

	setColor(c) {
		this.color = c
		this.ta.style.color = c
		this.refocus()
	}

	setSize(sizeDoc) {
		this.size = sizeDoc
		this.position()
		this.refocus()
	}

	refocus() {
		// toolbar clicks take the focus away (and close the keyboard on tablets)
		setTimeout(() => this.ta.focus(), 0)
	}

	/** Save (true) or discard (false) and close. Returns true if something changed. */
	close(save = true) {
		if (this.closed) return false
		this.closed = true
		const text = this.ta.value.replace(/\s+$/, '')
		let changed = false
		if (save) {
			if (this.item) {
				const layer = this.model.layerOf(this.item.id)
				if (layer && !text) {
					this.model.removeItem(layer, this.item)
					changed = true
				} else if (layer && (text !== this.item.text || this.color !== this.item.color || this.size !== this.item.size)) {
					const { w, h } = measureText(text, this.size)
					this.model.replaceItem(layer, this.item, { ...this.item, text, color: this.color, size: this.size, w, h })
					changed = true
				}
			} else if (text) {
				const { w, h } = measureText(text, this.size)
				this.model.addItem({
					id: uid(), type: 'text', page: this.page, text, color: this.color, size: this.size, opacity: 1, w, h,
					x: this.origin.x, y: this.origin.y, ...this.axes,
				})
				changed = true
			}
		}
		this.ta.remove()
		this.bar.remove()
		this.v.hiddenItemId = null
		this.v.requestOverlay()
		this.onClose?.()
		return changed
	}

	remove() {
		if (this.closed) return
		const layer = this.item && this.model.layerOf(this.item.id)
		if (layer) this.model.removeItem(layer, this.item)
		this.closed = true
		this.ta.remove()
		this.bar.remove()
		this.v.hiddenItemId = null
		this.v.requestOverlay()
		this.onClose?.()
	}
}
