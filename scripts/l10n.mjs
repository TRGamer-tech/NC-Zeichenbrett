// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
// node scripts/l10n.mjs           -> check translations and generate l10n/<lang>.js|json
// node scripts/l10n.mjs --list    -> print all source strings
//
// Source strings are English and live in the code: t('...') in JS, $l->t('...') in PHP.
// Translations live in l10n/src/<lang>.json.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir) => readdirSync(dir).flatMap((f) => {
	const p = join(dir, f)
	return statSync(p).isDirectory() ? walk(p) : [p]
})

const strings = new Set()
const files = [...walk('src').filter((f) => f.endsWith('.js')), ...walk('lib'), ...walk('templates')]
const re = /(?:\bt|->t)\(\s*'((?:[^'\\]|\\.)*)'/g
for (const f of files) {
	const src = readFileSync(f, 'utf8')
	for (const m of src.matchAll(re)) strings.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
}
// t() calls with double-quoted strings
for (const f of files.filter((x) => x.endsWith('.js'))) {
	for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) strings.add(m[1].replace(/\\"/g, '"'))
}

if (process.argv.includes('--list')) {
	console.log(JSON.stringify(Object.fromEntries([...strings].sort().map((s) => [s, ''])), null, '\t'))
	process.exit(0)
}

const PLURAL = 'nplurals=2; plural=(n != 1);'
let ok = true
for (const file of readdirSync('l10n/src').filter((f) => f.endsWith('.json'))) {
	const lang = file.replace('.json', '')
	const dict = JSON.parse(readFileSync(join('l10n/src', file), 'utf8'))
	const missing = [...strings].filter((s) => !dict[s])
	const unused = Object.keys(dict).filter((s) => !strings.has(s))
	if (missing.length) { ok = false; console.error(`${lang}: missing ${missing.length}:`, missing) }
	if (unused.length) console.warn(`${lang}: unused (ignored):`, unused)
	for (const [k, v] of Object.entries(dict)) {
		const want = [...k.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join()
		const got = [...v.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join()
		if (want !== got) { ok = false; console.error(`${lang}: placeholder mismatch in "${k}"`) }
	}
	const translations = Object.fromEntries([...strings].filter((s) => dict[s]).sort().map((s) => [s, dict[s]]))
	writeFileSync(`l10n/${lang}.json`, JSON.stringify({ translations, pluralForm: PLURAL }, null, '    ') + '\n')
	writeFileSync(`l10n/${lang}.js`, `OC.L10N.register(\n    "zeichenbrett",\n    ${JSON.stringify(translations, null, '    ').replace(/\n/g, '\n    ')},\n"${PLURAL}");\n`)
	console.log(`${lang}: ${Object.keys(translations).length}/${strings.size}`)
}
process.exit(ok ? 0 : 1)
