// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// PDF loading and rendering (pdf.js). Writing lives in pdfsave.js (loaded on demand).

import * as pdfjs from 'pdfjs-dist'

const MARKER = 'ZeichenbrettData'
const loadSaver = () => import('./pdfsave.js')

/** Build the annotated PDF (lazy-loads pdf-lib) */
export async function exportPdf(cleanBytes, model, opts) {
	return (await loadSaver()).exportPdf(cleanBytes, model, opts)
}


export function setPdfWorker(url) {
	pdfjs.GlobalWorkerOptions.workerSrc = url
}

function containsAscii(bytes, str) {
	const pat = new TextEncoder().encode(str)
	let i = bytes.indexOf(pat[0])
	while (i !== -1 && i <= bytes.length - pat.length) {
		let ok = true
		for (let k = 1; k < pat.length; k++) if (bytes[i + k] !== pat[k]) { ok = false; break }
		if (ok) return true
		i = bytes.indexOf(pat[0], i + 1)
	}
	return false
}

export async function openPdf(bytes, onProgress) {
	let clean = bytes
	let layersJson = null
	if (containsAscii(bytes, '/' + MARKER)) {
		try {
			const res = await (await loadSaver()).stripBytes(bytes)
			if (res.clean) {
				layersJson = res.json
				clean = res.clean
			}
		} catch (e) {
			console.warn('[zeichenbrett] Konnte gespeicherte Ebenen nicht lesen', e)
		}
	}
	const task = pdfjs.getDocument({
		data: clean.slice(), // pdf.js transfers (detaches) the buffer
		isEvalSupported: false,
		enableXfa: false,
		disableAutoFetch: true,
	})
	if (onProgress) task.onProgress = onProgress
	const pdf = await task.promise
	const pages = []
	for (let i = 1; i <= pdf.numPages; i += 16) {
		const batch = []
		for (let k = i; k < Math.min(i + 16, pdf.numPages + 1); k++) batch.push(pdf.getPage(k))
		pages.push(...await Promise.all(batch))
	}
	let ocConfig = null
	try { ocConfig = await pdf.getOptionalContentConfig() } catch (e) { /* ignore */ }
	return { pdf, pages, cleanBytes: clean, layersJson, ocConfig }
}


export function pdfSource({ pages, ocConfig }) {
	const vpCache = new Map()
	const base = pages.map((p) => p.getViewport({ scale: 1 }))
	let ocPromise = ocConfig ? Promise.resolve(ocConfig) : undefined
	return {
		kind: 'pdf',
		count: pages.length,
		size: (i) => ({ w: base[i].width, h: base[i].height }),
		/** doc units -> page CSS pixels */
		transform(i, scale) {
			const key = i + ':' + scale
			let vp = vpCache.get(key)
			if (!vp) {
				if (vpCache.size > 400) vpCache.clear()
				vp = pages[i].getViewport({ scale })
				vpCache.set(key, vp)
			}
			return vp.transform
		},
		/** render page i (or a region of it) at `scale` device px per CSS px at zoom 1 */
		render(i, canvas, scale, region) {
			const vp = region
				? pages[i].getViewport({ scale, offsetX: -region.x, offsetY: -region.y })
				: pages[i].getViewport({ scale })
			canvas.width = region ? region.w : Math.max(1, Math.floor(vp.width))
			canvas.height = region ? region.h : Math.max(1, Math.floor(vp.height))
			const ctx2 = canvas.getContext('2d', { alpha: false })
			ctx2.fillStyle = '#fff'
			ctx2.fillRect(0, 0, canvas.width, canvas.height)
			const task = pages[i].render({
				canvas,
				canvasContext: ctx2,
				viewport: vp,
				optionalContentConfigPromise: ocPromise,
			})
			return { promise: task.promise, cancel: () => task.cancel() }
		},
		ocGroups() {
			if (!ocConfig) return []
			const out = []
			try {
				for (const [id, g] of ocConfig) out.push({ id, name: g.name || id, visible: g.visible })
			} catch (e) { /* older pdf.js */ }
			return out
		},
		setOcVisible(id, v) {
			ocConfig.setVisibility(id, v)
			ocPromise = Promise.resolve(ocConfig)
		},
	}
}
