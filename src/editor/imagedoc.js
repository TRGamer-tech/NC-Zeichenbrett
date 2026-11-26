// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Image loading / export. Editable layers are embedded inside PNG (private "zbRd"
// chunk) and JPEG (APP15 segments) files together with the ORIGINAL image bytes, so
// re-opening never degrades the picture and every layer stays editable.

import { drawItems } from './render.js'
import { t } from '../l10n.js'

const MAGIC = 'ZBRD'

// ---------- generic payload: [u32 jsonLen][json][original image bytes]
function packPayload(json, baseBytes) {
	const j = new TextEncoder().encode(JSON.stringify(json))
	const out = new Uint8Array(4 + j.length + baseBytes.length)
	new DataView(out.buffer).setUint32(0, j.length)
	out.set(j, 4)
	out.set(baseBytes, 4 + j.length)
	return out
}
function unpackPayload(buf) {
	const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0)
	const json = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + len)))
	return { json, base: buf.slice(4 + len) }
}

// ---------- PNG
const CRC_TABLE = (() => {
	const t = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		t[n] = c >>> 0
	}
	return t
})()
function crc32(bytes) {
	let c = 0xffffffff
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

function pngChunks(b) {
	const out = []
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
	let p = 8
	while (p + 12 <= b.length) {
		const len = dv.getUint32(p)
		const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7])
		out.push({ type, start: p, dataStart: p + 8, len })
		p += 12 + len
		if (type === 'IEND') break
	}
	return out
}

function readPng(b) {
	const c = pngChunks(b).find((x) => x.type === 'zbRd')
	return c ? unpackPayload(b.subarray(c.dataStart, c.dataStart + c.len)) : null
}

function writePng(b, payload) {
	const iend = pngChunks(b).find((x) => x.type === 'IEND')
	const chunk = new Uint8Array(12 + payload.length)
	const dv = new DataView(chunk.buffer)
	dv.setUint32(0, payload.length)
	chunk.set([0x7a, 0x62, 0x52, 0x64], 4) // "zbRd": ancillary, private, safe-to-copy
	chunk.set(payload, 8)
	dv.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)))
	const out = new Uint8Array(b.length + chunk.length)
	out.set(b.subarray(0, iend.start), 0)
	out.set(chunk, iend.start)
	out.set(b.subarray(iend.start), iend.start + chunk.length)
	return out
}

// ---------- JPEG
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8
const SEG_HDR = 4 + 1 + 2 + 2 // "ZBRD" \0 index total
const SEG_MAX = 65533 - SEG_HDR

function readJpeg(b) {
	const parts = []
	let total = 0
	let p = 2
	while (p + 4 <= b.length && b[p] === 0xff) {
		const marker = b[p + 1]
		if (marker === 0xda || marker === 0xd9) break // start of scan / end
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue }
		const len = (b[p + 2] << 8) | b[p + 3]
		if (marker === 0xef && len > SEG_HDR + 2 && String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) === MAGIC && b[p + 8] === 0) {
			const idx = (b[p + 9] << 8) | b[p + 10]
			total = (b[p + 11] << 8) | b[p + 12]
			parts[idx] = b.subarray(p + 4 + SEG_HDR, p + 2 + len)
		}
		p += 2 + len
	}
	if (!total || parts.length !== total || parts.some((x) => !x)) return null
	const size = parts.reduce((s, x) => s + x.length, 0)
	const buf = new Uint8Array(size)
	let o = 0
	for (const x of parts) { buf.set(x, o); o += x.length }
	return unpackPayload(buf)
}

function writeJpeg(b, payload) {
	const total = Math.ceil(payload.length / SEG_MAX)
	if (total > 65535) throw new Error(t('The image is too large to store the drawing inside it.'))
	// insert after SOI and an optional JFIF APP0
	let at = 2
	if (b[2] === 0xff && b[3] === 0xe0) at = 4 + ((b[4] << 8) | b[5])
	const segs = []
	for (let i = 0; i < total; i++) {
		const data = payload.subarray(i * SEG_MAX, Math.min(payload.length, (i + 1) * SEG_MAX))
		const seg = new Uint8Array(4 + SEG_HDR + data.length)
		const len = 2 + SEG_HDR + data.length
		seg.set([0xff, 0xef, len >> 8, len & 255, 0x5a, 0x42, 0x52, 0x44, 0, i >> 8, i & 255, total >> 8, total & 255])
		seg.set(data, 4 + SEG_HDR)
		segs.push(seg)
	}
	const extra = segs.reduce((s, x) => s + x.length, 0)
	const out = new Uint8Array(b.length + extra)
	out.set(b.subarray(0, at), 0)
	let o = at
	for (const s of segs) { out.set(s, o); o += s.length }
	out.set(b.subarray(at), o)
	return out
}

export function canEmbed(mime) {
	return mime === 'image/png' || mime === 'image/jpeg'
}

// ---------- open / render / export

async function decode(bytes, mime) {
	const blob = new Blob([bytes], { type: mime })
	try {
		return await createImageBitmap(blob, { imageOrientation: 'from-image' })
	} catch (e) {
		const url = URL.createObjectURL(blob)
		try {
			const img = new Image()
			img.src = url
			await img.decode()
			return img
		} finally {
			URL.revokeObjectURL(url)
		}
	}
}

export async function openImage(bytes, mime) {
	let base = bytes
	let baseMime = mime
	let json = null
	try {
		const payload = isPng(bytes) ? readPng(bytes) : isJpeg(bytes) ? readJpeg(bytes) : null
		if (payload) {
			json = payload.json
			base = payload.base
			baseMime = json?.extra?.baseMime || (isPng(base) ? 'image/png' : 'image/jpeg')
		}
	} catch (e) {
		console.warn('[zeichenbrett] Eingebettete Ebenen konnten nicht gelesen werden', e)
	}
	const bitmap = await decode(base, baseMime)
	return { bitmap, baseBytes: base, baseMime, layersJson: json }
}

// orient: 2x2 matrix [a,b,c,d] (canvas convention) applied to the original image around its centre
export const defaultImageState = (baseMime) => ({ baseMime, orient: [1, 0, 0, 1], crop: null, adjust: { brightness: 100, contrast: 100, saturation: 100 } })

/** Size after rotation / crop. rw/rh = rotated size before cropping */
export function stateSize(bitmap, st) {
	const w0 = bitmap.width; const h0 = bitmap.height
	const swap = st.orient[0] === 0
	const rw = swap ? h0 : w0
	const rh = swap ? w0 : h0
	return st.crop ? { w: st.crop.w, h: st.crop.h, rw, rh } : { w: rw, h: rh, rw, rh }
}

/** Rotated / flipped / cropped base image as canvas (no colour adjustments). */
export function renderBase(bitmap, st) {
	const { w, h, rw, rh } = stateSize(bitmap, st)
	const c = document.createElement('canvas')
	c.width = Math.max(1, Math.round(w))
	c.height = Math.max(1, Math.round(h))
	const ctx = c.getContext('2d')
	ctx.save()
	if (st.crop) ctx.translate(-st.crop.x, -st.crop.y)
	// rotate around the rotated canvas
	ctx.translate(rw / 2, rh / 2)
	const o = st.orient
	ctx.transform(o[0], o[1], o[2], o[3], 0, 0)
	ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
	ctx.restore()
	return c
}

export function cssFilter(adj) {
	if (!adj) return ''
	const { brightness: b = 100, contrast: c = 100, saturation: s = 100 } = adj
	if (b === 100 && c === 100 && s === 100) return ''
	return `brightness(${b}%) contrast(${c}%) saturate(${s}%)`
}

/** Same maths as the CSS filter functions, applied to pixels (works in every browser). */
export function applyAdjust(canvas, adj) {
	if (!cssFilter(adj)) return
	const b = adj.brightness / 100; const c = adj.contrast / 100; const s = adj.saturation / 100
	const ctx = canvas.getContext('2d')
	const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
	const d = img.data
	const m = [
		0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
		0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
		0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
	]
	const lut = new Float32Array(256)
	for (let i = 0; i < 256; i++) lut[i] = ((i / 255) * b - 0.5) * c + 0.5
	for (let i = 0; i < d.length; i += 4) {
		const r = lut[d[i]]; const g = lut[d[i + 1]]; const bl = lut[d[i + 2]]
		d[i] = (m[0] * r + m[1] * g + m[2] * bl) * 255
		d[i + 1] = (m[3] * r + m[4] * g + m[5] * bl) * 255
		d[i + 2] = (m[6] * r + m[7] * g + m[8] * bl) * 255
	}
	ctx.putImageData(img, 0, 0)
}

export async function exportImage({ bitmap, baseBytes, model, format, quality = 0.92, editable }) {
	const st = model.extra
	const canvas = renderBase(bitmap, st)
	applyAdjust(canvas, st.adjust)
	const ctx = canvas.getContext('2d')
	if (format === 'image/jpeg') {
		// JPEG has no alpha: put the image on white
		const bg = document.createElement('canvas')
		bg.width = canvas.width; bg.height = canvas.height
		const b = bg.getContext('2d')
		b.fillStyle = '#fff'
		b.fillRect(0, 0, bg.width, bg.height)
		b.drawImage(canvas, 0, 0)
		ctx.drawImage(bg, 0, 0)
	}
	ctx.save()
	ctx.beginPath()
	ctx.rect(0, 0, canvas.width, canvas.height)
	ctx.clip()
	for (const layer of model.layers) {
		if (!layer.visible) continue
		drawItems(ctx, layer.items, [1, 0, 0, 1, 0, 0], layer.opacity)
	}
	ctx.restore()
	const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error(t('The image could not be created (too large?).'))), format, quality))
	let bytes = new Uint8Array(await blob.arrayBuffer())
	const realFormat = blob.type || format
	if (editable && canEmbed(realFormat)) {
		const payload = packPayload(model.toJSON(), baseBytes)
		bytes = realFormat === 'image/png' ? writePng(bytes, payload) : writeJpeg(bytes, payload)
	}
	return { bytes, mime: realFormat }
}

// ---------- viewer source
export function imageSource(getBase, getFilter) {
	return {
		kind: 'image',
		count: 1,
		size: () => { const c = getBase(); return { w: c.width, h: c.height } },
		transform: (i, scale) => [scale, 0, 0, scale, 0, 0],
		render(i, canvas, scale, region) {
			const base = getBase()
			const ctx = canvas.getContext('2d')
			if (region) {
				canvas.width = region.w; canvas.height = region.h
				ctx.imageSmoothingQuality = 'high'
				ctx.drawImage(base, region.x / scale, region.y / scale, region.w / scale, region.h / scale, 0, 0, region.w, region.h)
			} else {
				canvas.width = Math.max(1, Math.round(base.width * scale))
				canvas.height = Math.max(1, Math.round(base.height * scale))
				ctx.imageSmoothingQuality = 'high'
				ctx.drawImage(base, 0, 0, canvas.width, canvas.height)
			}
			return { promise: Promise.resolve(), cancel() {} }
		},
		cssFilter: () => getFilter(),
	}
}
