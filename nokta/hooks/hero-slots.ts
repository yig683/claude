// The numbers the live model is drawn from, in one table shared by the shader and the code that drives it.
// Pure code: no `$`, no browser.

/** The slots of the vec4 array the shader reads each frame (`uU`). */
export const SLOT = {
  /** pitch, roll, yaw of the body (radians) */
  rot: 0,
  /** where the body stands (x, y, z) */
  loc: 1,
  /** the body's scale on each axis (squash and stretch) */
  scale: 2,
  /** left arm: shoulder (xyz) and the radius there; then the hand and its radius; then the right arm */
  armLS: 3,
  armLH: 4,
  armRS: 5,
  armRH: 6,
  /** blink (0 open .. 1 shut), look x, look z, lid (how much of each eye a lid covers from above) */
  face0: 7,
  /** brow tilt left, right (radians, inner end up), brow lift left, right */
  face1: 8,
  /** the mouth as a stroke: curve, half width, skew (smirk), wave */
  face2: 9,
  /** blush strength, alpha of the closed-eye arcs, eye size, height of the arcs (+ happy ^, - asleep U) */
  face3: 10,
  /** the stroke's height, its alpha, the open mouth's alpha, the round mouth's alpha */
  face4: 11,
  /** the open mouth: half width, depth, height, and 1 while the glossy beads are drawn */
  face5: 12,
  /** the round mouth: width, height, centre height, and the alpha of the brows */
  face6: 13,
  /** colours (linear rgb): body, blush, lines, tint */
  base: 14,
  blush: 15,
  line: 16,
  tint: 17,
  /** the colour of the light under the skin (rgb), and 1 when the eyes glow instead of shine */
  sssc: 18,
  /** frame: centre x, centre z, half width (scene units), body kind (0 nokta, 1 bulut, 2 tavsan, 3 ucgen) */
  view: 19,
  /** accessory (0 none, 1 glasses, 2 beret, 3 bowtie), sway of the ears, 1 with a nose, 0 */
  style: 20,
  /** where the face sits: eye x, eye z, brow height, mouth height */
  layout: 21,
  /** the size of an eye: radius x, z, depth, 0 */
  layout2: 22,
  /** each eye: centre + radius x; right axis + radius y; up axis + radius z (the body's own space); then each lid */
  eyeL0: 23,
  eyeL1: 24,
  eyeL2: 25,
  eyeR0: 26,
  eyeR1: 27,
  eyeR2: 28,
  lidL0: 29,
  lidL1: 30,
  lidL2: 31,
  lidR0: 32,
  lidR1: 33,
  lidR2: 34,
  /** the centres of the two blushes */
  cheekL: 35,
  cheekR: 36,
  /** the nose of the rabbit: centre + radius x; right axis + radius y; up axis + radius z */
  nose0: 37,
  nose1: 38,
  nose2: 39,
  /** fourteen slots of the accessory (glasses: rims, bridge, temples; beret: head and stem; bow tie: frame) */
  acc0: 40,
  /** the colour of the accessory's metal, and of its cloth */
  accMetal: 54,
  accCloth: 55,
} as const

export const ACC_SLOTS = 14
export const NSLOT = 56

/** The tuning numbers of the light and the material, `uP[i]`; each palette has its own set (hero-palette.ts). */
export const P = {
  ambient: 0,
  ambR: 1,
  ambG: 2,
  ambB: 3,
  key: 4,
  keyWrap: 5,
  fill: 6,
  fillWrap: 7,
  rimL: 8,
  rimR: 9,
  rimWrap: 10,
  top: 11,
  bounce: 12,
  spec: 13,
  specExp: 14,
  coat: 15,
  coatExp: 16,
  sss: 17,
  sssR: 18,
  sssG: 19,
  sssB: 20,
  sheen: 21,
  sheenPow: 22,
  ao: 23,
  exposure: 24,
  rimSpec: 26,
  rimSpecExp: 27,
  gain: 28,
  eyeLight: 29,
  eyeSpec: 30,
  browThick: 31,
  glow: 32,
  /** the studio's lights mirrored in the skin: how much (the reflectance looking straight on), how much more at a slant, how blurred */
  env: 33,
  envF: 34,
  envBlur: 35,
  /** the same for the metal of glasses, the pane of their lenses, and the pale world around it all */
  envMetal: 36,
  lens: 37,
  world: 38,
  /** the size of the glints on the eyes (1 as the model has them), how much of the light a painted line leaves out of its shine, the studio mirrored in the eyes and how blurred */
  glint: 39,
  lineMatte: 40,
  eyeEnv: 41,
  eyeBlur: 42,
} as const

export const NP = 48

/** The names of the numbers in the order of `uP`, to write a fitted set out. */
export const P_NAMES = Object.keys(P) as (keyof typeof P)[]

export const BODY_INDEX = { nokta: 0, bulut: 1, tavsan: 2, ucgen: 3 } as const
export const ACCESSORY_INDEX = { none: 0, glasses: 1, beret: 2, bowtie: 3 } as const

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
/** '#rrggbb' as linear rgb. */
export function hexLinear(hex: string): number[] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(i => lin(Number.parseInt(h.slice(i, i + 2), 16) / 255))
}
