// Writes the numbers fitted in compare.html (what `NK.dump('fits.json')` kept, in ./out) into nokta/hooks/hero-palette.ts:
// the clay's numbers as the base, and for each other colour the numbers of the light fitted to its renders, plus those
// of the gloss that differ from the base.
//
//   node --import ./loader.mjs apply-fits.mjs out/fits.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { P } from '../../nokta/hooks/hero-slots'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = path.join(here, '..', '..', 'nokta', 'hooks', 'hero-palette.ts')
const input = process.argv[2]
if (input === undefined) {
  console.error('usage: node --import ./loader.mjs apply-fits.mjs out/fits.json')
  process.exit(1)
}
const fits = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'))

/** The look whose renders each set of numbers was fitted to. */
const BASE_LOOK = 'nokta-clay-none'
const PALETTES = {
  SKY: { look: 'nokta-sky-none', what: 'the renders of nokta-sky (and checked on bulut-sky)' },
  SAGE: { look: 'nokta-sage-none', what: 'the renders of nokta-sage' },
  KRAFT: { look: 'nokta-kraft-none', what: 'the renders of nokta-kraft' },
  PEACH: { look: 'tavsan-peach-none', what: 'the renders of tavsan-peach' },
  INK: { look: 'nokta-ink-none', what: 'the renders of nokta-ink and ucgen-ink together' },
}
/** The numbers of the light on the body: every palette has all of them. The rest (the face, the glasses) come from the base unless a palette differs. */
const LIGHT = ['ambient', 'ambR', 'ambG', 'ambB', 'key', 'keyWrap', 'fill', 'fillWrap', 'rimL', 'rimR', 'top', 'bounce', 'spec', 'specExp', 'sss', 'sssR', 'sssG', 'sssB', 'sheen', 'sheenPow', 'ao', 'exposure', 'rimSpec', 'rimSpecExp', 'gain']

const order = Object.keys(P).sort((a, b) => P[a] - P[b])
const fmt = value => String(Number(Number(value).toFixed(4)))
const block = (name, comment, values, type) => {
  const lines = order.filter(key => key in values).map(key => `  ${key}: ${fmt(values[key])},`)
  return `/** ${comment} */\nconst ${name}: ${type} = {\n${lines.join('\n')}\n}\n`
}
const numbersOf = look => {
  const values = fits[look]
  if (values === undefined) throw new Error(`no numbers for ${look} in ${input}: fit it, or load it, before dumping`)
  return values
}

const base = numbersOf(BASE_LOOK)
let text = block('BASE_FIT', 'Fitted to the renders of nokta-clay: the light of the studio on warm clay, and the face, the glasses and the glossy parts as they go on every look. The other palettes start from it.', base, 'Record<keyof typeof P, number>')
for (const [name, { look, what }] of Object.entries(PALETTES)) {
  const values = numbersOf(look)
  const own = {}
  for (const key of order) {
    if (LIGHT.includes(key) || fmt(values[key]) !== fmt(base[key])) own[key] = values[key]
  }
  text += `\n${block(name, `Fitted to ${what}.`, own, 'Fit')}`
}

const begin = '// ---- begin fitted numbers (tools/nokta-live/apply-fits.mjs rewrites what lies between these two lines) ----'
const end = '// ---- end fitted numbers ----'
let source = fs.readFileSync(target, 'utf8')
const crlf = source.includes('\r\n')
if (crlf) source = source.split('\r\n').join('\n')
const from = source.indexOf(begin)
const to = source.indexOf(end)
if (from < 0 || to < 0 || to < from) throw new Error(`the markers are not in ${target}`)
source = `${source.slice(0, from + begin.length)}\n\n${text}\n${source.slice(to)}`
fs.writeFileSync(target, crlf ? source.split('\n').join('\r\n') : source)
console.log(`wrote ${path.relative(process.cwd(), target)} from ${input}`)
