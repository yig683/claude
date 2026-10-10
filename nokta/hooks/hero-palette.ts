// The colours of the looks (nk_char.PALETTE and the accessories' stuff of batch_anim) and, for each, the numbers of
// the light and the material fitted to its Blender renders (tools/nokta-live: compare.html fits, apply-fits.mjs writes).
// Pure code: no `$`, no browser.
import type { NoktaColor } from '../types'
import { hexLinear, NP, P } from './hero-slots'

type Fit = Partial<Record<keyof typeof P, number>>

// ---- begin fitted numbers (tools/nokta-live/apply-fits.mjs rewrites what lies between these two lines) ----

/** Fitted to the renders of nokta-clay: the light of the studio on warm clay, and the face, the glasses and the glossy parts as they go on every look. The other palettes start from it. */
const BASE_FIT: Record<keyof typeof P, number> = {
  ambient: 0.5987,
  ambR: 0.7157,
  ambG: 0.9707,
  ambB: 1.2971,
  key: 0.966,
  keyWrap: 0.1936,
  fill: 0.2908,
  fillWrap: 0.2444,
  rimL: 3.8849,
  rimR: 2.6697,
  rimWrap: -0.1,
  top: 0.2439,
  bounce: 0.0171,
  spec: 0.0866,
  specExp: 8.7865,
  coat: 0,
  coatExp: 120,
  sss: 0.1975,
  sssR: 0.5826,
  sssG: 0,
  sssB: 0,
  sheen: 0.4407,
  sheenPow: 1.9851,
  ao: 1.9027,
  exposure: -0.0577,
  rimSpec: 0.6322,
  rimSpecExp: 24.5609,
  gain: 1.0008,
  eyeLight: 1.6864,
  eyeSpec: 0,
  browThick: 0.8775,
  glow: 1,
  env: 0,
  envF: 8,
  envBlur: 0.1,
  envMetal: 0.5872,
  lens: 0.03,
  world: 0.1403,
  glint: 1.2348,
  lineMatte: 0.6471,
  eyeEnv: 0.6277,
  eyeBlur: 0.1588,
}

/** Fitted to the renders of nokta-sky (and checked on bulut-sky). */
const SKY: Fit = {
  ambient: 0.4881,
  ambR: 1.2139,
  ambG: 0.9993,
  ambB: 0.8027,
  key: 0.7848,
  keyWrap: 0.0903,
  fill: 0.2595,
  fillWrap: 0.4041,
  rimL: 1.23,
  rimR: 0.4054,
  top: 0.14,
  bounce: 0.0624,
  spec: 0.1099,
  specExp: 8,
  sss: 0.2033,
  sssR: 0.0018,
  sssG: 0.1673,
  sssB: 0.239,
  sheen: 0.1695,
  sheenPow: 1.2705,
  ao: 1.2253,
  exposure: 0.0159,
  rimSpec: 0.5388,
  rimSpecExp: 20.5139,
  gain: 0.9985,
}

/** Fitted to the renders of nokta-sage. */
const SAGE: Fit = {
  ambient: 0.4929,
  ambR: 1.1176,
  ambG: 0.9163,
  ambB: 0.9627,
  key: 0.854,
  keyWrap: 0.1091,
  fill: 0.2509,
  fillWrap: 0.5117,
  rimL: 0.9599,
  rimR: 0.6444,
  top: 0.2555,
  bounce: 0.0524,
  spec: 0.0779,
  specExp: 8,
  sss: 0.0317,
  sssR: 0.252,
  sssG: 0,
  sssB: 0,
  sheen: 0.2421,
  sheenPow: 1.5643,
  ao: 1.74,
  exposure: -0.0057,
  rimSpec: 0.5164,
  rimSpecExp: 21.3497,
  gain: 1.0024,
}

/** Fitted to the renders of nokta-kraft. */
const KRAFT: Fit = {
  ambient: 0.4895,
  ambR: 0.8865,
  ambG: 0.88,
  ambB: 0.9002,
  key: 0.7864,
  keyWrap: 0.116,
  fill: 0.305,
  fillWrap: 0.7653,
  rimL: 2.445,
  rimR: 0.4791,
  top: 0.2138,
  bounce: 0.109,
  spec: 0.0979,
  specExp: 8,
  sss: 0.0565,
  sssR: 0.7358,
  sssG: 0.1178,
  sssB: 0,
  sheen: 0.2286,
  sheenPow: 2.008,
  ao: 1.5263,
  exposure: -0.0017,
  rimSpec: 0.5735,
  rimSpecExp: 17.9452,
  gain: 1,
}

/** Fitted to the renders of tavsan-peach. */
const PEACH: Fit = {
  ambient: 0.4891,
  ambR: 1.0744,
  ambG: 1.0921,
  ambB: 1.0212,
  key: 0.7199,
  keyWrap: 0.1708,
  fill: 0.2322,
  fillWrap: 0.3433,
  rimL: 2.5571,
  rimR: 0.7095,
  top: 0.2436,
  bounce: 0.0489,
  spec: 0.1694,
  specExp: 8,
  sss: 0.1793,
  sssR: 0.6809,
  sssG: 0.0904,
  sssB: 0,
  sheen: 0.1796,
  sheenPow: 1.5288,
  ao: 0.1975,
  exposure: -0.0467,
  rimSpec: 0.4761,
  rimSpecExp: 19.8205,
  gain: 0.9961,
}

/** Fitted to the renders of nokta-ink and ucgen-ink together. */
const INK: Fit = {
  ambient: 0.5038,
  ambR: 0.77,
  ambG: 0.7863,
  ambB: 0.9053,
  key: 0.6458,
  keyWrap: 0.2969,
  fill: 0.0069,
  fillWrap: 0.9974,
  rimL: 2.8004,
  rimR: 2.5636,
  top: 0.6556,
  bounce: 0.122,
  spec: 0.0499,
  specExp: 18.1071,
  sss: 0.5349,
  sssR: 0.1944,
  sssG: 0.2314,
  sssB: 0.1329,
  sheen: 1.027,
  sheenPow: 2.1742,
  ao: 4.2813,
  exposure: 0.1667,
  rimSpec: 0.3493,
  rimSpecExp: 26.6925,
  gain: 1.231,
  env: 0.2742,
  envF: 10.4421,
  envBlur: 0.2263,
  envMetal: 0,
  lens: 0.06,
  world: 0.04,
}

// ---- end fitted numbers ----

export type Palette = {
  base: string
  blush: string
  line: string
  tint: string
  /** the colour of the light under the skin */
  sss: readonly [number, number, number]
  /** the eyes glow (ivory, lit from within) instead of shining like glass beads */
  isGlow: boolean
  /** what an accessory is made of on this look: the metal of glasses, the cloth of a beret and a bow tie */
  metal: string
  cloth: string
  fit: Fit
}

export const PALETTES: Record<NoktaColor, Palette> = {
  clay: { base: '#E07B57', blush: '#F26F7E', line: '#4A2015', tint: '#FFB08F', sss: [1.0, 0.36, 0.2], isGlow: false, metal: '#23201D', cloth: '#2B2926', fit: {} },
  sky: { base: '#A8C4DA', blush: '#F4A992', line: '#2F3B4A', tint: '#DCEBF7', sss: [0.55, 0.78, 1.0], isGlow: false, metal: '#23201D', cloth: '#2B2926', fit: SKY },
  sage: { base: '#A8BC93', blush: '#F0A68C', line: '#33402B', tint: '#DDEBCB', sss: [0.7, 1.0, 0.55], isGlow: false, metal: '#23201D', cloth: '#2B2926', fit: SAGE },
  kraft: { base: '#D6BE92', blush: '#EC9E80', line: '#4A3321', tint: '#F5E6C8', sss: [1.0, 0.6, 0.35], isGlow: false, metal: '#23201D', cloth: '#2B2926', fit: KRAFT },
  peach: { base: '#F4C7B1', blush: '#F29478', line: '#5A2C1E', tint: '#FFE0D2', sss: [1.0, 0.45, 0.3], isGlow: false, metal: '#23201D', cloth: '#2B2926', fit: PEACH },
  ink: { base: '#4B4742', blush: '#D9764F', line: '#FFEBD2', tint: '#8A857C', sss: [0.5, 0.5, 0.5], isGlow: true, metal: '#E9DCC8', cloth: '#E07B57', fit: INK },
}

/** The colours of a palette as the shader takes them (linear rgb). */
export function paletteColors(name: NoktaColor): { base: number[]; blush: number[]; line: number[]; tint: number[]; metal: number[]; cloth: number[] } {
  const p = PALETTES[name]
  return {
    base: hexLinear(p.base),
    blush: hexLinear(p.blush),
    line: hexLinear(p.line),
    tint: hexLinear(p.tint),
    metal: hexLinear(p.metal),
    cloth: hexLinear(p.cloth),
  }
}

/** The numbers of the light and the material for a palette, `uP`. */
export function paletteP(name: NoktaColor): Float32Array {
  const out = new Float32Array(NP)
  const merged: Record<string, number> = { ...BASE_FIT, ...PALETTES[name].fit }
  for (const [key, index] of Object.entries(P)) out[index] = merged[key] ?? 0
  return out
}
