// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Document model: layers containing immutable items, plus an undo history.
//
// Item types (all coordinates are in "document units": PDF user space for PDFs,
// image pixels for images):
//   stroke: { id, type:'stroke', page, tool, paths:[Float64Array-like number[] (x0,y0,x1,y1,...)],
//             color, width, opacity, blend }
//   text:   { id, type:'text', page, x, y, ux, uy, vx, vy, size, color, opacity, text, w, h }
//           (x,y) = top-left corner, (ux,uy) = unit "right" vector, (vx,vy) = unit "down" vector

let idCounter = 0
export const uid = (p = 'i') => p + Date.now().toString(36) + (idCounter++).toString(36)

export function newLayer(name) {
	return { id: uid('l'), name, visible: true, locked: false, opacity: 1, items: [] }
}

export class Model {
	constructor() {
		this.layers = [newLayer('Ebene 1')]
		this.activeId = this.layers[0].id
		this.extra = null // image state (rotation, crop, adjustments) – JSON-serialisable
		this.undoStack = []
		this.redoStack = []
		this.dirty = false
		this.listeners = new Set()
	}

	onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
	emit(kind = 'items') { for (const fn of this.listeners) fn(kind) }

	get active() { return this.layers.find((l) => l.id === this.activeId) || this.layers[0] }

	snapshot() {
		return {
			layers: this.layers.map((l) => ({ ...l, items: l.items.slice() })),
			activeId: this.activeId,
			extra: this.extra ? JSON.parse(JSON.stringify(this.extra)) : null,
		}
	}

	restore(s) {
		this.layers = s.layers.map((l) => ({ ...l, items: l.items.slice() }))
		this.activeId = s.activeId
		this.extra = s.extra ? JSON.parse(JSON.stringify(s.extra)) : null
	}

	/** Call before every undoable mutation. */
	checkpoint() {
		this.undoStack.push(this.snapshot())
		if (this.undoStack.length > 200) this.undoStack.shift()
		this.redoStack.length = 0
		this.dirty = true
	}

	undo() {
		if (!this.undoStack.length) return false
		this.redoStack.push(this.snapshot())
		this.restore(this.undoStack.pop())
		this.dirty = true
		this.emit('all')
		return true
	}

	redo() {
		if (!this.redoStack.length) return false
		this.undoStack.push(this.snapshot())
		this.restore(this.redoStack.pop())
		this.dirty = true
		this.emit('all')
		return true
	}

	layerById(id) { return this.layers.find((l) => l.id === id) }

	addItem(item, layer = this.active) {
		this.checkpoint()
		layer.items = [...layer.items, item] // new array: render caches are keyed by array identity
		this.emit('items')
	}

	replaceItem(layer, oldItem, newItem) {
		this.checkpoint()
		layer.items = layer.items.map((it) => (it === oldItem || it.id === oldItem.id ? newItem : it))
		this.emit('items')
	}

	removeItem(layer, item) {
		this.checkpoint()
		layer.items = layer.items.filter((it) => it !== item && it.id !== item.id)
		this.emit('items')
	}

	/** layer that contains the item with this id */
	layerOf(id) {
		return this.layers.find((l) => l.items.some((it) => it.id === id))
	}

	/** Multi-step edits (eraser drag) that should become ONE undo step. */
	beginGesture() {
		this.checkpoint()
		this._gestureChanged = false
	}

	gestureSetItems(layer, items) {
		layer.items = items
		this._gestureChanged = true
		this.emit('items')
	}

	endGesture() {
		if (!this._gestureChanged) {
			// nothing happened: drop the checkpoint again
			this.undoStack.pop()
		}
		this._gestureChanged = false
	}

	/** Replace the item lists of several layers in one undo step. */
	replaceItems(map /* Map<layer, items[]> */) {
		this.checkpoint()
		for (const [layer, items] of map) layer.items = items
		this.emit('items')
	}

	addLayer(name) {
		this.checkpoint()
		const l = newLayer(name || this.nextLayerName())
		const idx = this.layers.indexOf(this.active)
		this.layers.splice(idx + 1, 0, l)
		this.activeId = l.id
		this.emit('layers')
		return l
	}

	duplicateLayer(layer) {
		this.checkpoint()
		const l = { ...newLayer(layer.name + ' (Kopie)'), opacity: layer.opacity, items: layer.items.map((it) => ({ ...it, id: uid() })) }
		this.layers.splice(this.layers.indexOf(layer) + 1, 0, l)
		this.activeId = l.id
		this.emit('layers')
	}

	removeLayer(layer) {
		this.checkpoint()
		const idx = this.layers.indexOf(layer)
		this.layers.splice(idx, 1)
		if (!this.layers.length) this.layers.push(newLayer('Ebene 1'))
		if (this.activeId === layer.id) this.activeId = this.layers[Math.max(0, idx - 1)].id
		this.emit('layers')
	}

	moveLayer(layer, dir) {
		const idx = this.layers.indexOf(layer)
		const to = idx + dir
		if (to < 0 || to >= this.layers.length) return
		this.checkpoint()
		this.layers.splice(idx, 1)
		this.layers.splice(to, 0, layer)
		this.emit('layers')
	}

	mergeDown(layer) {
		const idx = this.layers.indexOf(layer)
		if (idx <= 0) return
		this.checkpoint()
		const below = this.layers[idx - 1]
		// bake the upper layer's opacity into its items so the result looks the same
		const f = layer.opacity / (below.opacity || 1)
		below.items = below.items.concat(layer.items.map((it) => ({ ...it, opacity: Math.min(1, (it.opacity ?? 1) * f) })))
		this.layers.splice(idx, 1)
		this.activeId = below.id
		this.emit('layers')
	}

	/** Changes that should be undoable but are not item changes (rename, opacity, lock). */
	updateLayer(layer, props, undoable = true) {
		if (undoable) this.checkpoint()
		else this.dirty = true
		Object.assign(layer, props)
		this.emit('layers')
	}

	clearLayer(layer) {
		this.checkpoint()
		layer.items = []
		this.emit('items')
	}

	nextLayerName() {
		let n = this.layers.length + 1
		const names = new Set(this.layers.map((l) => l.name))
		while (names.has('Ebene ' + n)) n++
		return 'Ebene ' + n
	}

	isEmpty() { return this.layers.every((l) => l.items.length === 0) }

	toJSON() {
		return {
			version: 1,
			activeId: this.activeId,
			extra: this.extra,
			layers: this.layers.map((l) => ({
				id: l.id, name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity,
				items: l.items.map(serializeItem),
			})),
		}
	}

	load(json) {
		if (!json || !Array.isArray(json.layers) || !json.layers.length) return
		this.layers = json.layers.map((l) => ({
			id: l.id || uid('l'),
			name: String(l.name ?? 'Ebene'),
			visible: l.visible !== false,
			locked: !!l.locked,
			opacity: typeof l.opacity === 'number' ? l.opacity : 1,
			items: (l.items || []).map(deserializeItem).filter(Boolean),
		}))
		this.activeId = this.layers.find((l) => l.id === json.activeId)?.id || this.layers[this.layers.length - 1].id
		this.extra = json.extra || null
		this.undoStack = []
		this.redoStack = []
		this.dirty = false
	}
}

const round = (v) => Math.round(v * 100) / 100

function serializeItem(it) {
	if (it.type === 'stroke') {
		return { ...it, paths: it.paths.map((p) => Array.from(p, round)) }
	}
	return { ...it }
}

function deserializeItem(it) {
	if (!it || typeof it.page !== 'number') return null
	if (it.type === 'stroke' && Array.isArray(it.paths)) {
		return { ...it, id: it.id || uid(), paths: it.paths.filter((p) => Array.isArray(p) && p.length >= 2) }
	}
	if (it.type === 'text' && typeof it.text === 'string') return { ...it, id: it.id || uid() }
	return null
}
