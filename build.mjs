// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// Build: node build.mjs [--watch]
import * as esbuild from 'esbuild'
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs'

const watch = process.argv.includes('--watch')
const prod = !watch

rmSync('js', { recursive: true, force: true })
mkdirSync('js', { recursive: true })

const common = {
	bundle: true,
	minify: prod,
	sourcemap: prod ? false : 'inline',
	target: ['es2022', 'chrome110', 'firefox115', 'safari16.4'],
	legalComments: 'linked',
	logLevel: 'info',
	define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development') },
}

const builds = [
	// tiny bootstrap for the Files app (classic script)
	{ ...common, entryPoints: ['src/main.js'], outfile: 'js/zeichenbrett-main.js', format: 'iife' },
	// admin + personal settings page
	{ ...common, entryPoints: ['src/settings.js'], outfile: 'js/zeichenbrett-settings.js', format: 'iife' },
	// the editor, loaded on demand via import()
	{ ...common, entryPoints: { 'zeichenbrett-editor': 'src/editor/index.js' }, outdir: 'js', splitting: true, chunkNames: 'zb-[hash]', format: 'esm', loader: { '.css': 'text' } },
]

// pdf.js worker. Copied with a .js extension so every web server sends a JavaScript MIME type
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'js/pdf.worker.min.js')
// pdf.js helper data: WebAssembly decoders, standard fonts, CJK character maps, ICC profiles
for (const dir of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
	cpSync(`node_modules/pdfjs-dist/${dir}`, `js/pdfjs/${dir}`, { recursive: true })
}

if (watch) {
	for (const b of builds) (await esbuild.context(b)).watch()
} else {
	await Promise.all(builds.map((b) => esbuild.build(b)))
}
