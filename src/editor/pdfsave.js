// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// PDF writing with pdf-lib. Loaded on demand (only when saving, or when opening a
// PDF that already contains Zeichenbrett drawings) to keep opening fast.
//
// Export format: every annotated page gets ONE extra Form XObject with the drawings,
// wrapped in marked content bound to an Optional Content Group (a real PDF layer).
// The original page content is wrapped in q/Q so its graphics state cannot leak.
// The catalog gets a private /ZeichenbrettData entry listing every object we added
// plus the drawings as JSON. Re-opening removes exactly those objects, so the
// drawings stay editable and are never burnt in twice.

import {
	PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFHexString, PDFRawStream, PDFStream,
	StandardFonts, decodePDFRawStream,
} from 'pdf-lib'
import { TEXT_ASCENT, LINE_HEIGHT } from './render.js'

export const MARKER = 'ZeichenbrettData'

/** Load a PDF, remove previous Zeichenbrett data. Returns { clean bytes | null, json } */
export async function stripBytes(bytes) {
	const doc = await PDFDocument.load(bytes, { updateMetadata: false })
	const res = strip(doc)
	if (!res.found) return { clean: null, json: null }
	const clean = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
	return { clean, json: res.json }
}

function lookupInherited(ctx, dict, key) {
	let d = dict
	for (let depth = 0; d && depth < 64; depth++) {
		const v = d.get(PDFName.of(key))
		if (v !== undefined) return v
		const parent = d.get(PDFName.of('Parent'))
		d = parent ? ctx.lookup(parent) : null
	}
	return undefined
}

function removeRefs(arr, refs) {
	if (!(arr instanceof PDFArray)) return
	for (let i = arr.size() - 1; i >= 0; i--) {
		const o = arr.get(i)
		if (o instanceof PDFRef && refs.has(o.toString())) arr.remove(i)
	}
}

/** Remove everything a previous Zeichenbrett export added. Returns { found, json }. */
export function strip(doc) {
	const ctx = doc.context
	const cat = doc.catalog
	const entry = cat.lookupMaybe(PDFName.of(MARKER), PDFDict)
	if (!entry) return { found: false, json: null }

	let json = null
	const dataRef = entry.get(PDFName.of('Data'))
	try {
		const ds = dataRef && ctx.lookup(dataRef)
		if (ds instanceof PDFRawStream) {
			json = JSON.parse(new TextDecoder().decode(decodePDFRawStream(ds).decode()))
		}
	} catch (e) {
		console.warn('[zeichenbrett] Ebenen-Daten beschädigt', e)
	}

	const pageEntries = entry.lookupMaybe(PDFName.of('Pages'), PDFArray)
	if (pageEntries) {
		for (let i = 0; i < pageEntries.size(); i++) {
			const pe = pageEntries.lookupMaybe(i, PDFArray)
			if (!pe) continue
			const page = ctx.lookup(pe.get(0))
			if (!(page instanceof PDFDict)) continue
			const own = new Set([pe.get(1), pe.get(2)].filter((r) => r instanceof PDFRef).map(String))
			const contents = page.lookup(PDFName.of('Contents'))
			removeRefs(contents, own)
			const xname = pe.get(3)
			const res = ctx.lookup(lookupInherited(ctx, page, 'Resources'))
			if (res instanceof PDFDict && xname instanceof PDFName) {
				const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict)
				if (xo) xo.delete(xname)
			}
		}
	}

	const ours = entry.lookupMaybe(PDFName.of('OCGs'), PDFArray)
	const ocp = cat.lookupMaybe(PDFName.of('OCProperties'), PDFDict)
	if (ours && ocp) {
		const set = new Set()
		for (let i = 0; i < ours.size(); i++) set.add(String(ours.get(i)))
		removeRefs(ocp.lookupMaybe(PDFName.of('OCGs'), PDFArray), set)
		const d = ocp.lookupMaybe(PDFName.of('D'), PDFDict)
		if (d) for (const k of ['Order', 'ON', 'OFF']) removeRefs(d.lookupMaybe(PDFName.of(k), PDFArray), set)
		const remaining = ocp.lookupMaybe(PDFName.of('OCGs'), PDFArray)
		if (entry.get(PDFName.of('CreatedOCP'))?.asBoolean?.() && (!remaining || remaining.size() === 0)) {
			cat.delete(PDFName.of('OCProperties'))
		}
	}

	const objs = entry.lookupMaybe(PDFName.of('Objects'), PDFArray)
	if (objs) for (let i = 0; i < objs.size(); i++) { const r = objs.get(i); if (r instanceof PDFRef) ctx.delete(r) }
	if (dataRef instanceof PDFRef) ctx.delete(dataRef)
	const entryRef = cat.get(PDFName.of(MARKER))
	cat.delete(PDFName.of(MARKER))
	if (entryRef instanceof PDFRef) ctx.delete(entryRef)
	return { found: true, json }
}

const num = (v) => {
	const s = (Math.round(v * 1000) / 1000).toString()
	return s === '-0' ? '0' : s
}
function rgb(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || [0, '000000']
	const n = parseInt(m[1], 16)
	return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map(num).join(' ')
}

function ensureContentsArray(ctx, page) {
	const raw = page.get(PDFName.of('Contents'))
	const val = raw ? ctx.lookup(raw) : undefined
	if (val instanceof PDFArray) return val
	const arr = ctx.obj(raw instanceof PDFRef ? [raw] : [])
	if (val instanceof PDFStream && !(raw instanceof PDFRef)) {
		// direct stream object (rare, not really allowed) – make it indirect
		arr.push(ctx.register(val))
	}
	page.set(PDFName.of('Contents'), arr)
	return arr
}

function ensureOwnResources(ctx, page) {
	const inherited = lookupInherited(ctx, page, 'Resources')
	let res = inherited ? ctx.lookup(inherited) : null
	if (!(res instanceof PDFDict)) {
		res = ctx.obj({})
		page.set(PDFName.of('Resources'), res)
	} else if (!page.get(PDFName.of('Resources'))) {
		// inherited from the page tree: give the page its own (shallow) copy
		res = res.clone(ctx)
		page.set(PDFName.of('Resources'), res)
	}
	let xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict)
	if (!xo) {
		xo = ctx.obj({})
		res.set(PDFName.of('XObject'), xo)
	}
	return xo
}

/**
 * Build the annotated PDF.
 * @param {Uint8Array} cleanBytes original PDF without previous Zeichenbrett data
 * @param {import('./model.js').Model} model
 * @param {{editable:boolean}} opts
 */
export async function exportPdf(cleanBytes, model, { editable = true } = {}) {
	const doc = await PDFDocument.load(cleanBytes, { updateMetadata: false })
	const ctx = doc.context
	const pages = doc.getPages()
	const created = []
	const pageEntries = []

	const layers = model.layers.filter((l) => l.items.length > 0)
	const needsFont = layers.some((l) => l.items.some((it) => it.type === 'text'))
	let font = null
	let charset = null
	if (needsFont) {
		font = await doc.embedFont(StandardFonts.Helvetica)
		charset = new Set(font.getCharacterSet())
		created.push(font.ref)
	}

	// Optional Content Groups = PDF layers
	const ocgRefs = layers.map((l) => {
		const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText(l.name) }))
		created.push(ref)
		return ref
	})
	let createdOCP = false
	if (ocgRefs.length) {
		let ocp = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)
		if (!ocp) {
			ocp = ctx.obj({ OCGs: [], D: { Order: [], ON: [], OFF: [] } })
			doc.catalog.set(PDFName.of('OCProperties'), ocp)
			createdOCP = true
		}
		let ocgs = ocp.lookupMaybe(PDFName.of('OCGs'), PDFArray)
		if (!ocgs) { ocgs = ctx.obj([]); ocp.set(PDFName.of('OCGs'), ocgs) }
		let d = ocp.lookupMaybe(PDFName.of('D'), PDFDict)
		if (!d) { d = ctx.obj({}); ocp.set(PDFName.of('D'), d) }
		const arr = (k) => {
			let a = d.lookupMaybe(PDFName.of(k), PDFArray)
			if (!a) { a = ctx.obj([]); d.set(PDFName.of(k), a) }
			return a
		}
		const order = arr('Order')
		// Order lists top layer first, like the layer panel
		for (let i = ocgRefs.length - 1; i >= 0; i--) {
			ocgs.push(ocgRefs[i])
			order.push(ocgRefs[i])
			arr(layers[i].visible ? 'ON' : 'OFF').push(ocgRefs[i])
		}
	}

	for (let pi = 0; pi < pages.length; pi++) {
		const perLayer = layers.map((l) => l.items.filter((it) => it.page === pi))
		if (!perLayer.some((a) => a.length)) continue
		const page = pages[pi]
		const gs = new Map()
		const gsName = (alpha, blend) => {
			const key = num(alpha) + blend
			if (!gs.has(key)) gs.set(key, { name: 'G' + gs.size, alpha, blend })
			return gs.get(key).name
		}
		const props = {}
		let out = ''
		perLayer.forEach((items, li) => {
			if (!items.length) return
			const layer = layers[li]
			props['L' + li] = ocgRefs[li]
			out += `/OC /L${li} BDC\n`
			for (const it of items) {
				const alpha = Math.max(0, Math.min(1, (it.opacity ?? 1) * layer.opacity))
				const g = gsName(alpha, it.blend === 'multiply' ? 'Multiply' : 'Normal')
				if (it.type === 'stroke') {
					out += `q /${g} gs ${rgb(it.color)} RG ${num(it.width)} w ${it.cap === 'butt' ? 0 : 1} J 1 j\n`
					for (const p of it.paths) {
						if (p.length < 2) continue
						out += `${num(p[0])} ${num(p[1])} m\n`
						if (p.length === 2) out += `${num(p[0] + 0.001)} ${num(p[1])} l\n`
						for (let i = 2; i < p.length; i += 2) out += `${num(p[i])} ${num(p[i + 1])} l\n`
					}
					out += 'S Q\n'
				} else if (it.type === 'text' && font) {
					const lines = it.text.split('\n')
					out += `q /${g} gs ${rgb(it.color)} rg BT /F1 ${num(it.size)} Tf\n`
					lines.forEach((line, i) => {
						const safe = Array.from(line).map((ch) => charset.has(ch.codePointAt(0)) ? ch : '?').join('')
						const d = it.size * (TEXT_ASCENT + i * LINE_HEIGHT)
						const bx = it.x + it.vx * d
						const by = it.y + it.vy * d
						// text space is y-up, our "down" vector points the other way
						out += `${num(it.ux)} ${num(it.uy)} ${num(-it.vx)} ${num(-it.vy)} ${num(bx)} ${num(by)} Tm ${font.encodeText(safe).toString()} Tj\n`
					})
					out += 'ET Q\n'
				}
			}
			out += 'EMC\n'
		})

		const extG = {}
		for (const { name, alpha, blend } of gs.values()) {
			extG[name] = { Type: 'ExtGState', CA: alpha, ca: alpha, BM: blend }
		}
		const resources = { ExtGState: extG, Properties: props }
		if (font) resources.Font = { F1: font.ref }
		const mb = page.getMediaBox()
		const form = ctx.flateStream(out, {
			Type: 'XObject',
			Subtype: 'Form',
			BBox: [mb.x, mb.y, mb.x + mb.width, mb.y + mb.height],
			Resources: resources,
		})
		const formRef = ctx.register(form)
		const xnameStr = 'ZB' + pi + '_' + Math.random().toString(36).slice(2, 7)
		const xname = PDFName.of(xnameStr)
		const head = ctx.register(ctx.stream('q\n'))
		const tail = ctx.register(ctx.stream(`Q q /${xnameStr} Do Q\n`))
		created.push(formRef, head, tail)

		const contents = ensureContentsArray(ctx, page.node)
		contents.insert(0, head)
		contents.push(tail)
		ensureOwnResources(ctx, page.node).set(xname, formRef)
		pageEntries.push(ctx.obj([page.ref, head, tail, xname]))
	}

	if (editable) {
		const data = ctx.flateStream(new TextEncoder().encode(JSON.stringify(model.toJSON())))
		const dataRef = ctx.register(data)
		const entry = ctx.obj({
			V: 1,
			Generator: PDFHexString.fromText('Zeichenbrett for Nextcloud'),
			Data: dataRef,
			Pages: pageEntries,
			OCGs: ocgRefs,
			Objects: created,
			CreatedOCP: createdOCP,
		})
		doc.catalog.set(PDFName.of(MARKER), ctx.register(entry))
	}
	// no object streams: keeps the marker greppable so opening un-annotated PDFs stays fast
	return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
}

// ---------------------------------------------------------------------------
// Viewer source (used by viewer.js)

