// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Canvas rendering of model items. The same visual rules are used by the PDF exporter.

import { multiply } from './geometry.js'

export const FONT_FAMILY = 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif'
export const TEXT_ASCENT = 0.78 // baseline of the first line, relative to font size
export const LINE_HEIGHT = 1.2

const pathCache = new WeakMap()
function pathOf(it) {
	let p = pathCache.get(it)
	if (!p) {
		p = new Path2D()
		for (const pts of it.paths) {
			if (pts.length < 2) continue
			p.moveTo(pts[0], pts[1])
			if (pts.length === 2) p.lineTo(pts[0] + 0.001, pts[1])
			for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1])
		}
		pathCache.set(it, p)
	}
	return p
}

/**
 * Draw items onto ctx. `m` maps document units to device pixels.
 * The caller is responsible for clipping.
 */
export function drawItems(ctx, items, m, layerOpacity = 1) {
	for (const it of items) drawItem(ctx, it, m, layerOpacity)
}

export function drawItem(ctx, it, m, layerOpacity = 1) {
	const alpha = (it.opacity ?? 1) * layerOpacity
	if (alpha <= 0) return
	ctx.globalAlpha = alpha
	ctx.globalCompositeOperation = it.blend === 'multiply' ? 'multiply' : 'source-over'
	if (it.type === 'stroke') {
		ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
		ctx.strokeStyle = it.color
		ctx.lineWidth = it.width
		ctx.lineCap = it.cap || 'round'
		ctx.lineJoin = 'round'
		ctx.stroke(pathOf(it))
	} else if (it.type === 'text') {
		const t = multiply(m, [it.ux, it.uy, it.vx, it.vy, it.x, it.y])
		ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5])
		ctx.fillStyle = it.color
		ctx.font = `${it.size}px ${FONT_FAMILY}`
		ctx.textBaseline = 'alphabetic'
		const lines = it.text.split('\n')
		for (let i = 0; i < lines.length; i++) {
			ctx.fillText(lines[i], 0, it.size * (TEXT_ASCENT + i * LINE_HEIGHT))
		}
	}
	ctx.globalAlpha = 1
	ctx.globalCompositeOperation = 'source-over'
}

let measureCtx = null
/** Width/height of a (multi-line) text in units of `size`. */
export function measureText(text, size) {
	measureCtx ??= document.createElement('canvas').getContext('2d')
	measureCtx.font = `100px ${FONT_FAMILY}`
	const lines = text.split('\n')
	const w = Math.max(...lines.map((l) => measureCtx.measureText(l).width)) / 100 * size
	const h = size * (TEXT_ASCENT + 0.25 + (lines.length - 1) * LINE_HEIGHT)
	return { w, h }
}
