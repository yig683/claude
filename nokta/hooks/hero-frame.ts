// One frame of the live model: everything the shader needs to draw Nokta at a moment, as plain numbers, and how it
// is packed into the table the shader reads (hero-slots.ts). The motion (hero-motion.ts) makes these; the shader
// (hero-shader.ts) draws them.
// Pure code: no `$`, no browser.
import type { NoktaAccessory, NoktaBody, NoktaColor } from '../types'
import type { Arm, ArmPose, BodyKind, V3 } from './hero-model'
import { accessoryFrames, armsFor, faceParts, LAYOUT, VIEW } from './hero-model'
import { paletteColors, PALETTES } from './hero-palette'
import { ACCESSORY_INDEX, BODY_INDEX, NSLOT, SLOT } from './hero-slots'

export type { Arm }

/** The mouth, as three shapes that fade into one another: a stroke, an open D and a round O. */
export type Mouth = {
  /** curve, half width, skew (0 even, 1 smirk), wave */
  stroke: readonly [number, number, number, number]
  strokeV0: number
  strokeAlpha: number
  /** half width, depth, height */
  open: readonly [number, number, number]
  openAlpha: number
  /** width, height, centre height */
  round: readonly [number, number, number]
  roundAlpha: number
}

/** A character as the person designed it, without its name. */
export type Look = { body: NoktaBody; color: NoktaColor; accessory: NoktaAccessory }

export type Frame = {
  look: Look
  /** pitch, roll, yaw */
  rot: readonly [number, number, number]
  loc: readonly [number, number, number]
  /** the body's scale on each axis (squash and stretch) */
  scale: readonly [number, number, number]
  arms: readonly [Arm, Arm]
  /** how far the ears of the rabbit sway sideways */
  earSway: number
  /** 0 the eyes are open, 1 shut (the beads flatten) */
  blink: number
  /** 1 while the glossy beads are drawn, 0 when only arcs stand for the eyes */
  beadOn: number
  /** how much of the closed-eye arcs shows, and how they curve (+ happy ^, - asleep U) */
  arcAlpha: number
  arcH: number
  gaze: readonly [number, number]
  /** how much of each eye a lid covers from above, and the lid's tilt */
  lid: number
  lidTilt: number
  eyeSize: number
  /** inner end up (left, right), lift (left, right) */
  brow: readonly [number, number, number, number]
  browAlpha: number
  mouth: Mouth
  blush: number
}

export function isBody(kind: string): kind is BodyKind {
  return kind in BODY_INDEX
}

/** The numbers of the face that depend on the body it is on. */
export const myOf = (body: BodyKind): number => LAYOUT[body].my

export function restFrame(look: Look): Frame {
  const my = myOf(look.body)
  return {
    look,
    rot: [0, 0.03, -0.06],
    loc: [0, 0, 0],
    scale: [1, 1, 1],
    arms: armsFor(look.body, 'down'),
    earSway: 0,
    blink: 0,
    beadOn: 1,
    arcAlpha: 0,
    arcH: -0.05,
    gaze: [0, 0],
    lid: 0,
    lidTilt: 0,
    eyeSize: 1,
    brow: [0.03, 0.03, 0, 0],
    browAlpha: 1,
    mouth: {
      stroke: [0.13, 0.23, 0, 0],
      strokeV0: my,
      strokeAlpha: 1,
      open: [0.23, 0.1, my + 0.1],
      openAlpha: 0,
      round: [0.06, 0.075, my],
      roundAlpha: 0,
    },
    blush: 0.62,
  }
}

export type { ArmPose }

/** The frame as the flat float table the shader reads (`uU`, NSLOT vec4s). */
export function packFrame(f: Frame, into: Float32Array = new Float32Array(NSLOT * 4)): Float32Array {
  const put = (slot: number, a: number, b: number, c: number, d: number): void => {
    into[slot * 4] = a
    into[slot * 4 + 1] = b
    into[slot * 4 + 2] = c
    into[slot * 4 + 3] = d
  }
  const putV = (slot: number, v: V3, w: number): void => put(slot, v[0], v[1], v[2], w)
  const kind = f.look.body
  const L = LAYOUT[kind]
  const view = VIEW[kind]
  const colors = paletteColors(f.look.color)
  const palette = PALETTES[f.look.color]
  put(SLOT.rot, f.rot[0], f.rot[1], f.rot[2], 0)
  put(SLOT.loc, f.loc[0], f.loc[1], f.loc[2], 0)
  put(SLOT.scale, f.scale[0], f.scale[1], f.scale[2], 0)
  const [l, r] = f.arms
  putV(SLOT.armLS, l.s, l.r0)
  putV(SLOT.armLH, l.h, l.r1)
  putV(SLOT.armRS, r.s, r.r0)
  putV(SLOT.armRH, r.h, r.r1)
  put(SLOT.face0, f.blink, f.gaze[0], f.gaze[1], f.lid)
  put(SLOT.face1, f.brow[0], f.brow[1], f.brow[2], f.brow[3])
  const m = f.mouth
  put(SLOT.face2, m.stroke[0], m.stroke[1], m.stroke[2], m.stroke[3])
  put(SLOT.face3, f.blush, f.arcAlpha, f.eyeSize, f.arcH)
  put(SLOT.face4, m.strokeV0, m.strokeAlpha, m.openAlpha, m.roundAlpha)
  put(SLOT.face5, m.open[0], m.open[1], m.open[2], f.beadOn)
  put(SLOT.face6, m.round[0], m.round[1], m.round[2], f.browAlpha)
  put(SLOT.base, colors.base[0] as number, colors.base[1] as number, colors.base[2] as number, 0)
  put(SLOT.blush, colors.blush[0] as number, colors.blush[1] as number, colors.blush[2] as number, 0)
  put(SLOT.line, colors.line[0] as number, colors.line[1] as number, colors.line[2] as number, 0)
  put(SLOT.tint, colors.tint[0] as number, colors.tint[1] as number, colors.tint[2] as number, 0)
  put(SLOT.sssc, palette.sss[0], palette.sss[1], palette.sss[2], palette.isGlow ? 1 : 0)
  put(SLOT.view, view[0], view[1], view[2], BODY_INDEX[kind])
  put(SLOT.style, ACCESSORY_INDEX[f.look.accessory], f.earSway, kind === 'tavsan' ? 1 : 0, 0)
  put(SLOT.layout, L.ex, L.ey, L.brow, L.my)
  put(SLOT.layout2, L.rx, L.rz, L.ry, 0)
  const body = { kind, scale: f.scale, arms: f.arms, earSway: f.earSway }
  const parts = faceParts(body, { look: f.gaze, size: f.eyeSize, lid: f.lid, lidTilt: f.lidTilt, blink: f.blink })
  const ell = (slot: number, e: { c: V3; r: V3; up: V3; rx: number; ry: number; rz: number }): void => {
    putV(slot, e.c, e.rx)
    putV(slot + 1, e.r, e.ry)
    putV(slot + 2, e.up, e.rz)
  }
  ell(SLOT.eyeL0, parts.eyes[0])
  ell(SLOT.eyeR0, parts.eyes[1])
  ell(SLOT.lidL0, parts.lids[0])
  ell(SLOT.lidR0, parts.lids[1])
  putV(SLOT.cheekL, parts.cheeks[0], 0)
  putV(SLOT.cheekR, parts.cheeks[1], 0)
  if (parts.nose !== undefined) ell(SLOT.nose0, parts.nose)
  const acc = accessoryFrames(body, f.look.accessory)
  for (let i = 0; i < acc.length; i += 1) into[SLOT.acc0 * 4 + i] = acc[i] as number
  put(SLOT.accMetal, colors.metal[0] as number, colors.metal[1] as number, colors.metal[2] as number, 0)
  put(SLOT.accCloth, colors.cloth[0] as number, colors.cloth[1] as number, colors.cloth[2] as number, 0)
  return into
}

/**
 * The looks the live model has been checked against the renders of, frame by frame (the 23 the renders hold: Nokta in
 * five colours with four accessories, and the three other bodies as they are). Any other look keeps the rendered pictures.
 */
const READY: ReadonlySet<string> = new Set([
  ...['clay', 'sky', 'sage', 'kraft', 'ink'].flatMap(color => ['none', 'glasses', 'beret', 'bowtie'].map(accessory => `nokta-${color}-${accessory}`)),
  'bulut-sky-none',
  'tavsan-peach-none',
  'ucgen-ink-none',
])

/** Whether the live model draws this look (the rest are shown with the rendered pictures). */
export function isLiveLook(look: Look): boolean {
  return READY.has(`${look.body}-${look.color}-${look.accessory}`)
}
