// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Pointer input. Deliberately simple: strokes are NOT selectable objects, so putting
// the pen down always draws a new stroke (no hitboxes that grab and move old lines).
//
//   pen / marker : draw (hold Shift for a straight line)
//   eraser       : removes only what it touches, on all drawings
//   two fingers, middle/right mouse button, Space + drag : pan,  Ctrl + wheel / pinch : zoom

import { uid } from './model.js'
import { simplify, eraseStrokePartially, itemHit } from './geometry.js'
import { drawItem } from './render.js'
import { t } from '../l10n.js'

export const TOOLS = {
	pen: { label: () => t('Pen'), key: 'p' },
	marker: { label: () => t('Highlighter'), key: 'm' },
	eraser: { label: () => t('Eraser'), key: 'e' },
}

export class Tools {
	constructor(viewer, model, settings) {
		this.v = viewer
		this.model = model
		this.s = settings
		this.pointers = new Map()
		this.action = null
		this.hover = null
		this.spaceDown = false
		const sc = viewer.scroller
		sc.addEventListener('pointerdown', (e) => this.onDown(e))
		sc.addEventListener('pointermove', (e) => this.onMove(e))
		sc.addEventListener('pointerup', (e) => this.onUp(e))
		sc.addEventListener('pointercancel', (e) => this.onUp(e))
		sc.addEventListener('pointerleave', () => { this.hover = null; this.v.requestLive() })
		sc.addEventListener('wheel', (e) => this.onWheel(e), { passive: false })
		sc.addEventListener('contextmenu', (e) => e.preventDefault())
		viewer.liveDraw = (ctx) => this.drawLive(ctx)
		this.updateCursor()
	}

	setTool(t) {
		this.cancelAction()
		this.s.tool = t
		this.updateCursor()
	}

	updateCursor() {
		this.v.scroller.style.cursor = this.spaceDown ? 'grab' : this.s.tool === 'eraser' ? 'none' : 'crosshair'
	}

	/** length in document units for a length in screen pixels at the current zoom */
	docLen(px) { return px / this.v.scale }

	touches() { return [...this.pointers.values()].filter((p) => p.type === 'touch') }

	onWheel(e) {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault()
			this.v.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX, e.clientY)
		}
	}

	onDown(e) {
		this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
		try { this.v.scroller.setPointerCapture(e.pointerId) } catch (er) { /* ignore */ }
		e.preventDefault()

		if (e.pointerType === 'touch' && this.touches().length >= 2) {
			// second finger: drop the stroke the first finger started, zoom/pan instead
			this.cancelAction()
			const two = this.touches().slice(0, 2)
			this.action = { type: 'pinch', last: pinchInfo(two) }
			return
		}
		if (this.action?.type === 'pinch') return

		if (e.button === 1 || e.button === 2 || this.spaceDown) {
			this.action = { type: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY }
			this.v.scroller.style.cursor = 'grabbing'
			return
		}
		if (e.button !== 0) return

		const pt = this.v.toDoc(e.clientX, e.clientY)
		if (this.s.tool === 'eraser') {
			this.model.beginGesture()
			this.action = { type: 'erase', id: e.pointerId, page: pt.page, lx: pt.x, ly: pt.y }
			this.eraseTo(pt.x, pt.y)
			return
		}
		if (!pt.inside) return
		this.action = { type: 'draw', id: e.pointerId, page: pt.page, tool: this.s.tool, pts: [pt.x, pt.y], shift: e.shiftKey }
		this.v.requestLive()
	}

	onMove(e) {
		const p = this.pointers.get(e.pointerId)
		if (p) { p.x = e.clientX; p.y = e.clientY }
		if (e.pointerType !== 'touch' && this.s.tool === 'eraser') {
			this.hover = { x: e.clientX, y: e.clientY }
			this.v.requestLive()
		}
		const a = this.action
		if (!a) return
		if (a.type === 'pinch') {
			const two = this.touches().slice(0, 2)
			if (two.length < 2) return
			const now = pinchInfo(two)
			if (a.last.d > 0) this.v.zoomBy(now.d / a.last.d, now.x, now.y)
			this.v.scroller.scrollLeft -= now.x - a.last.x
			this.v.scroller.scrollTop -= now.y - a.last.y
			a.last = now
			return
		}
		if (a.id !== e.pointerId) return
		if (a.type === 'pan') {
			this.v.scroller.scrollLeft -= e.clientX - a.x
			this.v.scroller.scrollTop -= e.clientY - a.y
			a.x = e.clientX; a.y = e.clientY
			return
		}
		const evs = e.getCoalescedEvents?.() || []
		for (const ev of (evs.length ? evs : [e])) {
			const pt = this.v.toDoc(ev.clientX, ev.clientY, a.page)
			if (a.type === 'erase') {
				this.eraseTo(pt.x, pt.y)
			} else {
				a.shift = ev.shiftKey
				const n = a.pts.length
				if (Math.hypot(pt.x - a.pts[n - 2], pt.y - a.pts[n - 1]) >= this.docLen(0.75)) a.pts.push(pt.x, pt.y)
				a.end = [pt.x, pt.y]
			}
		}
		this.v.requestLive()
	}

	onUp(e) {
		this.pointers.delete(e.pointerId)
		const a = this.action
		if (!a) return
		if (a.type === 'pinch') {
			if (this.touches().length < 2) this.action = null
			return
		}
		if (a.id !== e.pointerId) return
		this.action = null
		if (a.type === 'pan') this.updateCursor()
		else if (a.type === 'erase') this.model.endGesture()
		else if (a.type === 'draw' && e.type !== 'pointercancel') {
			const it = this.buildItem(a)
			if (it) this.model.addItem(it)
		}
		this.v.requestLive()
	}

	cancelAction() {
		if (this.action?.type === 'erase') this.model.endGesture()
		this.action = null
		this.v.requestLive()
	}

	buildItem(a) {
		const marker = a.tool === 'marker'
		let pts
		if (a.shift && a.end) {
			pts = [a.pts[0], a.pts[1], ...snapLine(a.pts[0], a.pts[1], a.end[0], a.end[1])]
		} else {
			pts = a.pts.slice()
			if (pts.length === 2) pts.push(pts[0] + this.docLen(0.01), pts[1]) // a dot
			pts = simplify(pts, this.docLen(0.35))
		}
		return {
			id: uid(), type: 'stroke', page: a.page, tool: a.tool, paths: [pts],
			color: this.s.color,
			width: this.docLen(marker ? this.s.markerWidth : this.s.width),
			opacity: marker ? 0.4 : 1,
			blend: marker ? 'multiply' : undefined,
			cap: marker ? 'butt' : 'round',
		}
	}

	eraseTo(x, y) {
		const a = this.action
		const r = this.docLen(this.s.eraserSize / 2)
		for (const layer of this.model.layers) {
			if (!layer.visible || layer.locked) continue
			let changed = false
			const out = []
			for (const it of layer.items) {
				if (it.page !== a.page) { out.push(it); continue }
				if (it.type === 'stroke') {
					const res = eraseStrokePartially(it, a.lx, a.ly, x, y, r)
					if (res === null) out.push(it)
					else { changed = true; out.push(...res) }
				} else if (itemHit(it, a.lx, a.ly, x, y, r)) {
					changed = true // text from older versions: removed as a whole
				} else {
					out.push(it)
				}
			}
			if (changed) this.model.gestureSetItems(layer, out)
		}
		a.lx = x; a.ly = y
	}

	drawLive(ctx) {
		const a = this.action
		if (a?.type === 'draw') {
			this.v.clipToPage(ctx, a.page)
			drawItem(ctx, this.buildItem(a), this.v.deviceMatrix(a.page))
		}
		if (this.s.tool === 'eraser' && this.hover) {
			const r = this.v.overlay.getBoundingClientRect()
			const d = this.v.dpr
			ctx.setTransform(1, 0, 0, 1, 0, 0)
			ctx.beginPath()
			ctx.arc((this.hover.x - r.left) * d, (this.hover.y - r.top) * d, this.s.eraserSize / 2 * d, 0, Math.PI * 2)
			ctx.lineWidth = d
			ctx.strokeStyle = 'rgba(0,0,0,0.8)'
			ctx.stroke()
			ctx.setLineDash([3 * d, 3 * d])
			ctx.strokeStyle = 'rgba(255,255,255,0.9)'
			ctx.stroke()
		}
	}
}

function pinchInfo(t) {
	return { x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2, d: Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y) }
}

/** straight line, snapped to 15° steps */
function snapLine(x0, y0, x1, y1) {
	const len = Math.hypot(x1 - x0, y1 - y0)
	const step = Math.PI / 12
	const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / step) * step
	return [x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len]
}
