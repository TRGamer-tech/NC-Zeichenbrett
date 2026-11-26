// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Geometry helpers: bounding boxes, hit tests, vector eraser, simplification, affine transforms.

import { uid } from './model.js'

const bboxCache = new WeakMap()

/** [minX, minY, maxX, maxY] including half the stroke width */
export function itemBBox(it) {
	let b = bboxCache.get(it)
	if (b) return b
	if (it.type === 'stroke') {
		let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
		for (const p of it.paths) {
			for (let i = 0; i < p.length; i += 2) {
				const x = p[i]; const y = p[i + 1]
				if (x < x0) x0 = x
				if (x > x1) x1 = x
				if (y < y0) y0 = y
				if (y > y1) y1 = y
			}
		}
		const h = it.width / 2
		b = [x0 - h, y0 - h, x1 + h, y1 + h]
	} else {
		const c = textCorners(it)
		b = [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))]
	}
	bboxCache.set(it, b)
	return b
}

export function textCorners(t) {
	const { x, y, ux, uy, vx, vy, w, h } = t
	return [[x, y], [x + ux * w, y + uy * w], [x + ux * w + vx * h, y + uy * w + vy * h], [x + vx * h, y + vy * h]]
}

function distToSeg2(px, py, ax, ay, bx, by) {
	const dx = bx - ax; const dy = by - ay
	const len2 = dx * dx + dy * dy
	let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
	t = t < 0 ? 0 : t > 1 ? 1 : t
	const qx = ax + t * dx - px; const qy = ay + t * dy - py
	return qx * qx + qy * qy
}

function bboxNear(b, ex0, ey0, ex1, ey1, r) {
	return !(b[2] < Math.min(ex0, ex1) - r || b[0] > Math.max(ex0, ex1) + r || b[3] < Math.min(ey0, ey1) - r || b[1] > Math.max(ey0, ey1) + r)
}

function textHit(t, ax, ay, bx, by, r) {
	// sample the eraser segment and test in the text's local frame
	const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(r, 1e-6)))
	for (let i = 0; i <= n; i++) {
		const px = ax + (bx - ax) * i / n - t.x
		const py = ay + (by - ay) * i / n - t.y
		const lx = px * t.ux + py * t.uy
		const ly = px * t.vx + py * t.vy
		if (lx >= -r && lx <= t.w + r && ly >= -r && ly <= t.h + r) return true
	}
	return false
}

function strokeHit(it, ax, ay, bx, by, r) {
	const rr = r + it.width / 2
	const rr2 = rr * rr
	for (const p of it.paths) {
		if (p.length === 2) {
			if (distToSeg2(p[0], p[1], ax, ay, bx, by) <= rr2) return true
			continue
		}
		for (let i = 0; i + 3 < p.length; i += 2) {
			if (segSegDist2(p[i], p[i + 1], p[i + 2], p[i + 3], ax, ay, bx, by) <= rr2) return true
		}
	}
	return false
}

function segSegDist2(ax, ay, bx, by, cx, cy, dx, dy) {
	if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0
	return Math.min(
		distToSeg2(ax, ay, cx, cy, dx, dy), distToSeg2(bx, by, cx, cy, dx, dy),
		distToSeg2(cx, cy, ax, ay, bx, by), distToSeg2(dx, dy, ax, ay, bx, by),
	)
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
	const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
	const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
	const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
	const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Returns true if the eraser segment (a->b, radius r) touches the item. */
export function itemHit(it, ax, ay, bx, by, r) {
	if (!bboxNear(itemBBox(it), ax, ay, bx, by, r)) return false
	return it.type === 'text' ? textHit(it, ax, ay, bx, by, r) : strokeHit(it, ax, ay, bx, by, r)
}

/**
 * Partial (pixel-like) vector eraser: cuts the parts of a stroke that lie within
 * the eraser segment's reach. Returns null if untouched, [] if completely erased,
 * otherwise an array with one new stroke item.
 */
export function eraseStrokePartially(it, ax, ay, bx, by, r) {
	if (!strokeHit(it, ax, ay, bx, by, r)) return null
	const rr = r + it.width / 2
	const rr2 = rr * rr
	const step = Math.max(rr / 3, 1e-3)
	const out = []
	for (const p of it.paths) {
		const pts = resample(p, step)
		let run = []
		for (let i = 0; i < pts.length; i += 2) {
			const x = pts[i]; const y = pts[i + 1]
			if (distToSeg2(x, y, ax, ay, bx, by) <= rr2) {
				if (run.length >= 4) out.push(run)
				run = []
			} else {
				run.push(x, y)
			}
		}
		if (run.length >= 4) out.push(run)
	}
	if (!out.length) return []
	return [{ ...it, id: uid(), paths: out.map((p) => simplify(p, step / 4)) }]
}

/** Insert points so that no segment is longer than `step`. */
function resample(p, step) {
	if (p.length < 4) return p.slice()
	const out = [p[0], p[1]]
	for (let i = 2; i < p.length; i += 2) {
		const x0 = p[i - 2]; const y0 = p[i - 1]; const x1 = p[i]; const y1 = p[i + 1]
		const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step)
		for (let k = 1; k <= n; k++) out.push(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)
	}
	return out
}

/** Ramer–Douglas–Peucker on a flat [x,y,...] array. */
export function simplify(p, eps) {
	const n = p.length / 2
	if (n < 3) return p.slice()
	const keep = new Uint8Array(n)
	keep[0] = keep[n - 1] = 1
	const eps2 = eps * eps
	const stack = [[0, n - 1]]
	while (stack.length) {
		const [s, e] = stack.pop()
		let maxD = -1; let idx = -1
		for (let i = s + 1; i < e; i++) {
			const d = distToSeg2(p[2 * i], p[2 * i + 1], p[2 * s], p[2 * s + 1], p[2 * e], p[2 * e + 1])
			if (d > maxD) { maxD = d; idx = i }
		}
		if (maxD > eps2) {
			keep[idx] = 1
			stack.push([s, idx], [idx, e])
		}
	}
	const out = []
	for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1])
	return out
}

/** Apply an affine matrix [a,b,c,d,e,f] to an item (used for image rotate / flip / crop). */
export function transformItem(it, m) {
	const [a, b, c, d, e, f] = m
	const X = (x, y) => a * x + c * y + e
	const Y = (x, y) => b * x + d * y + f
	if (it.type === 'stroke') {
		return {
			...it,
			paths: it.paths.map((p) => {
				const q = new Array(p.length)
				for (let i = 0; i < p.length; i += 2) { q[i] = X(p[i], p[i + 1]); q[i + 1] = Y(p[i], p[i + 1]) }
				return q
			}),
		}
	}
	return { ...it, x: X(it.x, it.y), y: Y(it.x, it.y), ux: a * it.ux + c * it.uy, uy: b * it.ux + d * it.uy, vx: a * it.vx + c * it.vy, vy: b * it.vx + d * it.vy }
}

export function invert([a, b, c, d, e, f]) {
	const det = a * d - b * c
	return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

export function apply(m, x, y) {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function multiply(m, n) { // m ∘ n  (apply n first, then m)
	return [
		m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
	]
}
