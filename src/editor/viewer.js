// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Scrollable, zoomable page viewer.
//
// * Pages are rendered lazily (only near the visible area) into a "base" canvas whose
//   pixel count is capped, so huge CAD plans do not blow up the browser's memory.
// * When zoomed in past that cap, a "detail" canvas renders only the visible region of
//   the page at full resolution – sharp lines at any zoom level.
// * Annotations are drawn as vectors on ONE screen-sized overlay canvas, so they are
//   always crisp and cost the same at 10 % or 2000 % zoom.

import { drawItems } from './render.js'
import { invert, apply } from './geometry.js'

const GAP = 16
const MAX_PIXELS = 16 * 1024 * 1024
const MAX_SIDE = 16384
// Page cost classes, measured on the first (light) render of a page:
// FAST pages may be fully re-rendered on zoom; pages up to HEAVY get one sharp re-render
// at full pixel density; heavier pages only get the visible region sharpened (renderDetail).
const FAST_PAGE_MS = 250
const HEAVY_PAGE_MS = 800

export class Viewer {
	constructor(stage, source, model) {
		this.stage = stage
		this.source = source
		this.model = model
		this.scale = 1
		this.minScale = 0.02
		this.maxScale = 40
		this.dpr = Math.min(window.devicePixelRatio || 1, 3)
		this.rects = []
		this.pages = [] // { div, base, renderedScale, task, detail, detailTask }
		this.hiddenPage = -1

		this.scroller = el('div', 'zb-scroll')
		this.sheet = el('div', 'zb-sheet')
		this.scroller.append(this.sheet)
		this.overlay = el('canvas', 'zb-overlay')
		this.live = el('canvas', 'zb-live')
		stage.append(this.scroller, this.overlay, this.live)
		this.octx = this.overlay.getContext('2d')
		this.lctx = this.live.getContext('2d')

		this.buildPages()
		this._onScroll = () => { this.interacting(); this.requestOverlay(); this.scheduleRender() }
		this.scroller.addEventListener('scroll', this._onScroll, { passive: true })
		this._ro = new ResizeObserver(() => this.onResize())
		this._ro.observe(this.scroller)
		this._unsub = model.onChange(() => this.requestOverlay())
		this.layerCache = new WeakMap()
		// Rendering runs in slices on the main thread. While the user draws, pans or
		// zooms, the next slice waits until the interaction has paused.
		this.interactUntil = 0
		this.waiting = []
		this.gate = (cont) => {
			if (performance.now() >= this.interactUntil) cont()
			else this.waiting.push(cont)
		}
		this.liveDraw = null // function(ctx) set by tools
	}

	destroy() {
		this._ro.disconnect()
		this._unsub()
		for (const p of this.pages) { p.task?.cancel(); p.detailTask?.cancel() }
		this.stage.innerHTML = ''
	}

	buildPages() {
		this.sheet.innerHTML = ''
		this.pages = []
		for (let i = 0; i < this.source.count; i++) {
			const div = el('div', 'zb-page')
			const base = el('canvas', 'zb-base')
			div.append(base)
			this.sheet.append(div)
			this.pages.push({ div, base, renderedScale: 0, task: null, detail: null, detailTask: null })
		}
		this.applyFilter()
	}

	/** Source changed (e.g. image rotated / cropped) */
	reset() {
		for (const p of this.pages) { p.task?.cancel(); p.detailTask?.cancel() }
		this.buildPages()
		this.layout()
		this.scheduleRender(0)
		this.requestOverlay()
	}

	applyFilter() {
		const f = this.source.cssFilter?.() || ''
		for (const p of this.pages) p.div.style.filter = f
	}

	onResize() {
		const first = !this._sized
		this._sized = true
		const w = this.scroller.clientWidth; const h = this.scroller.clientHeight
		this.overlay.width = this.live.width = Math.round(w * this.dpr)
		this.overlay.height = this.live.height = Math.round(h * this.dpr)
		this.overlay.style.width = this.live.style.width = w + 'px'
		this.overlay.style.height = this.live.style.height = h + 'px'
		if (first) this.fit('auto')
		else this.layout()
		this.requestOverlay()
		this.requestLive()
		this.scheduleRender()
	}

	// ------------------------------------------------------------------ layout
	layout() {
		const s = this.scale
		let maxW = 0
		for (let i = 0; i < this.source.count; i++) maxW = Math.max(maxW, this.source.size(i).w * s)
		const sheetW = Math.max(this.scroller.clientWidth, maxW + 2 * GAP)
		let y = GAP
		this.rects = []
		for (let i = 0; i < this.source.count; i++) {
			const { w, h } = this.source.size(i)
			const pw = w * s; const ph = h * s
			const x = (sheetW - pw) / 2
			this.rects.push({ x, y, w: pw, h: ph })
			const page = this.pages[i]
			const d = page.div.style
			d.left = x + 'px'; d.top = y + 'px'; d.width = pw + 'px'; d.height = ph + 'px'
			if (page.detail) {
				// keep the last sharp region visible (scaled) until a new one is rendered
				const f = s / page.detailScale
				const c = page.detailCss
				Object.assign(page.detail.style, { left: c.x * f + 'px', top: c.y * f + 'px', width: c.w * f + 'px', height: c.h * f + 'px' })
			}
			y += ph + GAP
		}
		this.sheet.style.width = sheetW + 'px'
		this.sheet.style.height = Math.max(y, this.scroller.clientHeight) + 'px'
	}

	fit(mode = 'width') {
		const cw = this.scroller.clientWidth - 2 * GAP
		const ch = this.scroller.clientHeight - 2 * GAP
		if (cw <= 0 || ch <= 0) return
		let maxW = 0; let firstH = 0
		for (let i = 0; i < this.source.count; i++) maxW = Math.max(maxW, this.source.size(i).w)
		firstH = this.source.size(0).h
		const sw = cw / maxW
		const sp = Math.min(sw, ch / firstH)
		let s = mode === 'page' ? sp : sw
		if (mode === 'auto') s = this.source.kind === 'image' ? Math.min(sp, 1) : sw
		this.setScale(s)
		this.scroller.scrollTop = 0
		this.scroller.scrollLeft = (this.scroller.scrollWidth - this.scroller.clientWidth) / 2
	}

	/** Zoom, keeping the content under (clientX, clientY) in place. */
	setScale(ns, clientX, clientY) {
		ns = Math.max(this.minScale, Math.min(this.maxScale, ns))
		const r = this.scroller.getBoundingClientRect()
		const ax = clientX === undefined ? r.width / 2 : clientX - r.left
		const ay = clientY === undefined ? r.height / 2 : clientY - r.top
		const cx = this.scroller.scrollLeft + ax
		const cy = this.scroller.scrollTop + ay
		let anchor = null
		if (this.rects.length) {
			const i = this.pageIndexAtContent(cx, cy)
			const pr = this.rects[i]
			anchor = { i, fx: (cx - pr.x) / pr.w, fy: (cy - pr.y) / pr.h }
		}
		const old = this.scale
		this.scale = ns
		this.layout()
		if (anchor) {
			const pr = this.rects[anchor.i]
			this.scroller.scrollLeft = pr.x + anchor.fx * pr.w - ax
			this.scroller.scrollTop = pr.y + anchor.fy * pr.h - ay
		}
		if (old !== ns) this.cancelStaleRenders()
		this.interacting()
		this.onZoom?.(ns)
		this.requestOverlay()
		this.requestLive()
		this.scheduleRender()
	}

	zoomBy(f, clientX, clientY) { this.setScale(this.scale * f, clientX, clientY) }

	/** Call on every pointer move / zoom step; holds back rendering for `ms`. */
	interacting(ms = 150) {
		this.interactUntil = Math.max(this.interactUntil, performance.now() + ms)
		clearTimeout(this._gateTimer)
		this._gateTimer = setTimeout(() => this.releaseGate(), ms + 5)
	}

	releaseGate() {
		if (performance.now() < this.interactUntil) {
			this._gateTimer = setTimeout(() => this.releaseGate(), this.interactUntil - performance.now() + 5)
			return
		}
		const w = this.waiting
		this.waiting = []
		for (const cont of w) cont()
	}

	/** After a zoom: abort renders for the old zoom level instead of waiting for them. */
	cancelStaleRenders() {
		for (const p of this.pages) {
			if (p.detailTask) { p.detailTask.cancel(); p.detailTask = null }
			// an in-flight base render is only dropped if there is already something to show
			if (p.task && p.renderedScale) { p.task.cancel(); p.task = null }
		}
		if (this._rendering) this._renderAgain = true
	}

	pageIndexAtContent(cx, cy) {
		let best = 0; let bestD = Infinity
		for (let i = 0; i < this.rects.length; i++) {
			const r = this.rects[i]
			const dy = cy < r.y ? r.y - cy : cy > r.y + r.h ? cy - r.y - r.h : 0
			const dx = cx < r.x ? r.x - cx : cx > r.x + r.w ? cx - r.x - r.w : 0
			const d = dy * 4 + dx
			if (d < bestD) { bestD = d; best = i }
			if (r.y > cy + 2000) break
		}
		return best
	}

	visibleRange(margin = 0) {
		const top = this.scroller.scrollTop - margin
		const bottom = this.scroller.scrollTop + this.scroller.clientHeight + margin
		let a = -1; let b = -1
		for (let i = 0; i < this.rects.length; i++) {
			const r = this.rects[i]
			if (r.y + r.h >= top && r.y <= bottom) { if (a < 0) a = i; b = i }
			else if (r.y > bottom) break
		}
		return a < 0 ? [] : Array.from({ length: b - a + 1 }, (_, k) => a + k)
	}

	currentPage() {
		const mid = this.scroller.scrollTop + this.scroller.clientHeight / 3
		return this.pageIndexAtContent(this.scroller.scrollLeft + this.scroller.clientWidth / 2, mid)
	}

	scrollToPage(i) {
		if (this.rects[i]) this.scroller.scrollTop = this.rects[i].y - GAP
	}

	// ------------------------------------------------------------- coordinates
	/** doc -> overlay device pixels for page i */
	deviceMatrix(i) {
		const P = this.source.transform(i, this.scale)
		const r = this.rects[i]
		const ox = r.x - this.scroller.scrollLeft
		const oy = r.y - this.scroller.scrollTop
		const d = this.dpr
		return [d * P[0], d * P[1], d * P[2], d * P[3], d * (P[4] + ox), d * (P[5] + oy)]
	}

	/** client (mouse) coordinates -> { page, x, y } in document units */
	toDoc(clientX, clientY, forcePage) {
		const r = this.scroller.getBoundingClientRect()
		const cx = clientX - r.left + this.scroller.scrollLeft
		const cy = clientY - r.top + this.scroller.scrollTop
		const page = forcePage ?? this.pageIndexAtContent(cx, cy)
		const pr = this.rects[page]
		const P = this.source.transform(page, this.scale)
		const [x, y] = apply(invert(P), cx - pr.x, cy - pr.y)
		const inside = cx >= pr.x && cx <= pr.x + pr.w && cy >= pr.y && cy <= pr.y + pr.h
		return { page, x, y, inside }
	}

	/** document vector of one CSS pixel in screen x / y direction (for text orientation) */
	screenAxes(page) {
		const Pi = invert(this.source.transform(page, this.scale))
		const ux = Pi[0]; const uy = Pi[1]; const vx = Pi[2]; const vy = Pi[3]
		const lu = Math.hypot(ux, uy); const lv = Math.hypot(vx, vy)
		return { ux: ux / lu, uy: uy / lu, vx: vx / lv, vy: vy / lv }
	}

	docToClient(page, x, y) {
		const P = this.source.transform(page, this.scale)
		const [px, py] = apply(P, x, y)
		const r = this.scroller.getBoundingClientRect()
		return [px + this.rects[page].x - this.scroller.scrollLeft + r.left, py + this.rects[page].y - this.scroller.scrollTop + r.top]
	}

	// --------------------------------------------------------------- rendering
	scheduleRender(delay = 120) {
		clearTimeout(this._renderTimer)
		this._pending = true
		busy(this)
		this._renderTimer = setTimeout(() => { this._pending = false; this.renderPass() }, delay)
	}

	async renderPass() {
		if (this._rendering) { this._renderAgain = true; return }
		this._rendering = true
		busy(this)
		try {
			const visible = this.visibleRange(0)
			const near = this.visibleRange(this.scroller.clientHeight * 1.5)
			const keep = new Set(this.visibleRange(this.scroller.clientHeight * 4))
			// free memory of far away pages
			for (let i = 0; i < this.pages.length; i++) {
				if (!keep.has(i) && this.pages[i].renderedScale) {
					const p = this.pages[i]
					p.task?.cancel()
					const empty = el('canvas', 'zb-base')
					p.base.replaceWith(empty)
					p.base = empty
					p.renderedScale = 0
					this.dropDetail(p)
				}
			}
			for (const i of visible) {
				if (this._renderAgain) break
				await this.renderBase(i)
			}
			// second round: sharp version of the pages that turned out to be cheap
			for (const i of visible) {
				if (this._renderAgain) break
				await this.renderBase(i)
			}
			for (const i of visible) {
				if (this._renderAgain) break
				await this.renderDetail(i)
			}
			for (const i of near) {
				if (this._renderAgain) break
				if (!visible.includes(i)) await this.renderBase(i)
			}
		} catch (e) {
			if (e?.name !== 'RenderingCancelledException') console.warn('[zeichenbrett] render', e)
		} finally {
			this._rendering = false
			if (this._renderAgain) { this._renderAgain = false; this.scheduleRender(0) }
			busy(this)
		}
	}

	/**
	 * Resolution for the full-page canvas. Every page is first rendered with one device
	 * pixel per CSS pixel (a quarter of the work on high-DPI screens). Pages that render
	 * quickly are then upgraded to full sharpness; heavy pages keep the light version and
	 * get sharp only where the user zooms in (renderDetail).
	 */
	targetBaseScale(i) {
		const { w, h } = this.source.size(i)
		const cap = Math.min(Math.sqrt(MAX_PIXELS / (w * h)), MAX_SIDE / w, MAX_SIDE / h)
		const p = this.pages[i]
		const light = Math.min(this.scale, cap)
		if (p.costMs === undefined || p.costMs > HEAVY_PAGE_MS) return light
		return Math.min(this.scale * this.dpr, cap)
	}

	async renderBase(i) {
		const p = this.pages[i]
		const target = this.targetBaseScale(i)
		if (p.renderedScale) {
			const ratio = target / p.renderedScale
			if (ratio < 1.15 && ratio > 0.25) return // close enough (or zoomed out: a sharper canvas is fine)
			const zoomedIn = this.scale / p.renderedCss >= 1.15
			if (zoomedIn && p.costMs > FAST_PAGE_MS) return // the detail view handles zoom-in
		}
		p.task?.cancel()
		const tmp = document.createElement('canvas')
		const task = this.source.render(i, tmp, target, null, this.gate)
		p.task = task
		const t0 = performance.now()
		try {
			await task.promise
			p.costMs ??= performance.now() - t0
			stat('base', i, t0, tmp)
		} catch (e) {
			if (e?.name === 'RenderingCancelledException') return
			throw e
		}
		if (p.task !== task) return
		p.task = null
		tmp.className = 'zb-base'
		p.base.replaceWith(tmp)
		p.base = tmp
		p.renderedScale = target
		p.renderedCss = this.scale
	}

	dropDetail(p) {
		p.detailTask?.cancel()
		p.detailTask = null
		if (p.detail) { p.detail.remove(); p.detail = null }
	}

	async renderDetail(i) {
		const p = this.pages[i]
		const heavy = p.costMs > HEAVY_PAGE_MS
		// heavy pages (soft masks, transparency): one device pixel per CSS pixel is a quarter
		// of the work on high-DPI screens and hardly visible when zoomed in
		const d = heavy ? 1 : this.dpr
		const want = this.scale * d
		const sharpEnough = heavy ? this.scale <= p.renderedCss * 1.3 : p.renderedScale >= want * 0.95
		if (!p.renderedScale || sharpEnough) { this.dropDetail(p); return }
		if (p.detailTask) return
		const r = this.rects[i]
		const sx = this.scroller.scrollLeft; const sy = this.scroller.scrollTop
		const vw = this.scroller.clientWidth; const vh = this.scroller.clientHeight
		// visible part of the page in page CSS px (+ a little margin)
		const m = 64
		const x0 = Math.max(0, sx - r.x - m); const y0 = Math.max(0, sy - r.y - m)
		const x1 = Math.min(r.w, sx + vw - r.x + m); const y1 = Math.min(r.h, sy + vh - r.y + m)
		if (x1 <= x0 || y1 <= y0) return
		const key = [x0, y0, x1, y1, this.scale].map(Math.round).join(',')
		if (p.detailKey === key && p.detail) return
		p.detailTask?.cancel()
		const region = { x: Math.floor(x0 * d), y: Math.floor(y0 * d), w: Math.ceil((x1 - x0) * d), h: Math.ceil((y1 - y0) * d) }
		const c = el('canvas', 'zb-detail')
		const task = this.source.render(i, c, want, region, this.gate)
		p.detailTask = task
		const t0 = performance.now()
		try {
			await task.promise
			stat(task.filtered ? 'detail*' : 'detail', i, t0, c)
		} catch (e) {
			if (e?.name === 'RenderingCancelledException') return
			throw e
		}
		if (p.detailTask !== task) return
		p.detailTask = null
		if (this.scale * d !== want) return // zoom changed meanwhile, a new pass follows
		p.detailScale = this.scale
		p.detailCss = { x: region.x / d, y: region.y / d, w: region.w / d, h: region.h / d }
		Object.assign(c.style, { left: p.detailCss.x + 'px', top: p.detailCss.y + 'px', width: p.detailCss.w + 'px', height: p.detailCss.h + 'px' })
		if (p.detail) p.detail.replaceWith(c)
		else p.div.append(c)
		p.detail = c
		p.detailKey = key
	}

	// ---------------------------------------------------------------- overlay
	requestOverlay() {
		if (this._ovRaf) return
		this._ovRaf = requestAnimationFrame(() => { this._ovRaf = 0; this.drawOverlay() })
	}

	requestLive() {
		if (this._lvRaf) return
		this._lvRaf = requestAnimationFrame(() => { this._lvRaf = 0; this.drawLive() })
	}

	itemsOnPage(layer, i) {
		let byPage = this.layerCache.get(layer.items)
		if (!byPage) {
			byPage = new Map()
			for (const it of layer.items) {
				let a = byPage.get(it.page)
				if (!a) byPage.set(it.page, a = [])
				a.push(it)
			}
			this.layerCache.set(layer.items, byPage)
		}
		return byPage.get(i) || []
	}

	clipToPage(ctx, i) {
		const r = this.rects[i]
		const d = this.dpr
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		ctx.beginPath()
		ctx.rect((r.x - this.scroller.scrollLeft) * d, (r.y - this.scroller.scrollTop) * d, r.w * d, r.h * d)
		ctx.clip()
	}

	drawOverlay() {
		const ctx = this.octx
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
		for (const i of this.visibleRange(0)) {
			const m = this.deviceMatrix(i)
			ctx.save()
			this.clipToPage(ctx, i)
			for (const layer of this.model.layers) {
				if (!layer.visible) continue
				const items = this.itemsOnPage(layer, i)
				if (items.length) drawItems(ctx, items, m, layer.opacity)
			}
			ctx.restore()
		}
	}

	drawLive() {
		const ctx = this.lctx
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		ctx.clearRect(0, 0, this.live.width, this.live.height)
		if (this.liveDraw) {
			ctx.save()
			this.liveDraw(ctx)
			ctx.restore()
		}
	}
}

/** Render timings for performance tests: enabled by setting window.__zbStats = [] */
function stat(kind, page, t0, canvas) {
	if (Array.isArray(window.__zbStats)) {
		window.__zbStats.push({ kind, page, ms: Math.round(performance.now() - t0), mpx: +(canvas.width * canvas.height / 1e6).toFixed(1), at: Math.round(performance.now()) })
	}
}

function busy(viewer) {
	if (Array.isArray(window.__zbStats)) window.__zbBusy = viewer._rendering || viewer._pending
}

function el(tag, cls) {
	const e = document.createElement(tag)
	if (cls) e.className = cls
	return e
}
