// Builds out/hero_gl.js for compare.html: the shader of the live model and, for every look of the renders, its 25 key
// frames (as the numbers the shader reads) and the numbers of its palette.
//
//   node --import ./loader.mjs build.mjs [part of a look's name, to build only those]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { packFrame } from '../../nokta/hooks/hero-frame'
import { LAYOUT, VIEW } from '../../nokta/hooks/hero-model'
import { referenceFrames } from '../../nokta/hooks/hero-moods'
import { paletteP } from '../../nokta/hooks/hero-palette'
import { fragSource, VERT } from '../../nokta/hooks/hero-shader'
import { NP, NSLOT, P, SLOT } from '../../nokta/hooks/hero-slots'

const here = path.dirname(fileURLToPath(import.meta.url))
const looksDir = path.join(here, '..', '..', 'nokta', 'assets', 'looks')
const only = process.argv[2]
const names = fs
  .readdirSync(looksDir)
  .map(file => file.replace('.json', ''))
  .filter(name => only === undefined || name.includes(only))

const data = { VERT, FRAG: fragSource(), P, NSLOT, NP, SLOT, looks: {} }
for (const name of names) {
  const [body, color, accessory] = name.split('-')
  const look = { body, color, accessory }
  const frames = Object.fromEntries(Object.entries(referenceFrames(look)).map(([key, frame]) => [key, Array.from(packFrame(frame))]))
  data.looks[name] = { frames, p: Array.from(paletteP(color)), view: VIEW[body], layout: LAYOUT[body] }
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true })
const target = path.join(here, 'out', 'hero_gl.js')
fs.writeFileSync(target, `window.NKGL = ${JSON.stringify(data)}`)
console.log(`wrote ${path.relative(process.cwd(), target)}: ${fs.statSync(target).size} bytes, ${names.length} looks, ${data.FRAG.split('\n').length} lines of shader`)
