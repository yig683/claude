// Nokta's model in plain numbers: the signed distance fields of nk_sdf.py / nk_char.py / nk_props.py, ported, so the
// code that drives the shader can ask the model questions (where is the surface here, which way does it face) and
// the tests can check the model without a graphics card. The shader (hero-shader.ts) draws the same shapes.
// Pure code: no `$`, no browser.
import type { NoktaAccessory, NoktaBody } from '../types'

export type V3 = readonly [number, number, number]

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: V3): number => Math.sqrt(dot(a, a))
export const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1))

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

export function smin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k)
  return b * (1 - h) + a * h - k * h * (1 - h)
}

export const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k)

export function ellipsoidD(p: V3, rx: number, ry: number, rz: number): number {
  const ax = p[0] / rx
  const ay = p[1] / ry
  const az = p[2] / rz
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az)
  const k1 = Math.sqrt((ax / rx) ** 2 + (ay / ry) ** 2 + (az / rz) ** 2)
  return k1 < 1e-8 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1
}

/** iq's sdRoundCone between two points (nk_sdf.round_cone). */
export function roundConeD(p: V3, a: V3, b: V3, r1: number, r2: number): number {
  const ba = sub(b, a)
  const l2 = dot(ba, ba)
  const rr = r1 - r2
  const a2 = l2 - rr * rr
  const il2 = 1 / l2
  const pa = sub(p, a)
  const y = dot(pa, ba)
  const z = y - l2
  const v = sub(mul(pa, l2), mul(ba, y))
  const x2 = dot(v, v)
  const y2 = y * y * l2
  const z2 = z * z * l2
  const k = Math.sign(rr) * rr * rr * x2
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
}

/** The 2D signed distance of a triangle (nk_sdf.tri2d). */
export function tri2d(x: number, y: number, A: readonly [number, number], B: readonly [number, number], C: readonly [number, number]): number {
  const e0 = [B[0] - A[0], B[1] - A[1]] as const
  const e1 = [C[0] - B[0], C[1] - B[1]] as const
  const e2 = [A[0] - C[0], A[1] - C[1]] as const
  const v0 = [x - A[0], y - A[1]] as const
  const v1 = [x - B[0], y - B[1]] as const
  const v2 = [x - C[0], y - C[1]] as const
  const pq = (v: readonly [number, number], e: readonly [number, number]): [number, number] => {
    const t = clamp01((v[0] * e[0] + v[1] * e[1]) / (e[0] * e[0] + e[1] * e[1]))
    return [v[0] - e[0] * t, v[1] - e[1] * t]
  }
  const p0 = pq(v0, e0)
  const p1 = pq(v1, e1)
  const p2 = pq(v2, e2)
  const s = Math.sign(e0[0] * e2[1] - e0[1] * e2[0])
  const dx = Math.min(p0[0] ** 2 + p0[1] ** 2, p1[0] ** 2 + p1[1] ** 2, p2[0] ** 2 + p2[1] ** 2)
  const dy = Math.min(s * (v0[0] * e0[1] - v0[1] * e0[0]), s * (v1[0] * e1[1] - v1[1] * e1[0]), s * (v2[0] * e2[1] - v2[1] * e2[0]))
  return -Math.sqrt(dx) * Math.sign(dy)
}

// ------------------------------------------------------------------ the bodies

export type BodyKind = NoktaBody

export type Arm = { s: V3; h: V3; r0: number; r1: number }

/** A body at a moment: which body, how it is squashed, where its arms are, how far its ears sway. */
export type Body = { kind: BodyKind; scale: V3; arms: readonly Arm[]; earSway: number }

/** How the face lies on each body (nk_char.face_layout): eyes, brows, mouth, cheeks, the size of an eye. */
export type Layout = { ex: number; ey: number; my: number; brow: number; cheek: readonly [number, number]; rx: number; rz: number; ry: number }

export const LAYOUT: Record<BodyKind, Layout> = {
  nokta: { ex: 0.4, ey: 0.05, my: -0.18, brow: 0.41, cheek: [0.66, -0.13], rx: 0.138, rz: 0.19, ry: 0.098 },
  bulut: { ex: 0.36, ey: 0.2, my: -0.06, brow: 0.52, cheek: [0.58, 0.0], rx: 0.105, rz: 0.145, ry: 0.088 },
  tavsan: { ex: 0.36, ey: 0.02, my: -0.28, brow: 0.34, cheek: [0.6, -0.18], rx: 0.104, rz: 0.144, ry: 0.086 },
  ucgen: { ex: 0.34, ey: -0.02, my: -0.3, brow: 0.17, cheek: [0.56, -0.2], rx: 0.118, rz: 0.162, ry: 0.092 },
}

/** The camera frame of each body (batch_anim.VIEW): centre x, centre z, half width. */
export const VIEW: Record<BodyKind, readonly [number, number, number]> = {
  nokta: [0.1, 0.2, 1.78],
  bulut: [0.0, 0.25, 2.08],
  tavsan: [0.0, 0.45, 2.02],
  ucgen: [0.0, 0.18, 1.9],
}

/** The top of each body (nk_char.TOP): where a hat sits. */
export const TOP: Record<BodyKind, number> = { nokta: 0.95, bulut: 1.5, tavsan: 0.95, ucgen: 1.0 }

const BULUT_LOBES: ReadonlyArray<readonly [V3, number]> = [
  [[0.0, 0.0, 0.1], 0.86],
  [[-0.98, 0.02, -0.12], 0.56],
  [[0.98, 0.02, -0.12], 0.56],
  [[-0.58, 0.0, 0.8], 0.52],
  [[0.1, 0.0, 1.02], 0.5],
  [[0.66, 0.0, 0.74], 0.47],
  [[-0.5, -0.05, -0.62], 0.44],
  [[0.5, -0.05, -0.62], 0.44],
  [[0.0, 0.1, -0.55], 0.5],
]

/** The ears of the rabbit: base, tip and the two radii of a round cone each (nk_char.body_field, ears upright). */
export function ears(sway: number): ReadonlyArray<readonly [V3, V3, number, number]> {
  return [-1, 1].map(sx => [[sx * 0.42, 0.12, 0.66] as V3, [sx * 0.63 + sway, 0.15, 1.52 - Math.abs(sway) * 0.1] as V3, 0.265, 0.2] as const)
}

export const UCGEN = { A: [0.0, 0.92], B: [0.98, -0.74], C: [-0.98, -0.74] } as const

const minScale = (s: V3): number => Math.min(s[0], s[1], s[2])

/** The distance to the body: negative inside (nk_char.body_field, with the arms joined by a smooth union). */
export function bodyD(b: Body, p: V3): number {
  let d: number
  const s = b.scale
  switch (b.kind) {
    case 'bulut': {
      const q: V3 = [p[0] / s[0], p[1] / s[1], p[2] / s[2]]
      const [c0, r0] = BULUT_LOBES[0] as readonly [V3, number]
      d = len(sub(q, c0)) - r0
      for (let i = 1; i < BULUT_LOBES.length; i += 1) {
        const [c, r] = BULUT_LOBES[i] as readonly [V3, number]
        d = smin(d, len(sub(q, c)) - r, 0.2)
      }
      d = smax(d, -(q[2] + 1.02), 0.16) * minScale(s)
      break
    }
    case 'tavsan': {
      d = ellipsoidD(p, 1.0 * s[0], 0.92 * s[1], 0.92 * s[2])
      for (const [a, c, r1, r2] of ears(b.earSway)) d = smin(d, roundConeD(p, a, c, r1, r2), 0.17)
      break
    }
    case 'ucgen': {
      const q: V3 = [p[0] / s[0], p[1] / s[1], p[2] / s[2]]
      const d2 = tri2d(q[0], q[2], UCGEN.A, UCGEN.B, UCGEN.C) - 0.58
      const wx = d2 + 0.36
      const wy = Math.abs(q[1]) - 0.18 + 0.36
      d = (Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) + Math.min(Math.max(wx, wy), 0) - 0.36) * minScale(s)
      break
    }
    default:
      d = ellipsoidD(p, 1.0 * s[0], 0.96 * s[1], 0.95 * s[2])
  }
  for (const a of b.arms) {
    if (a.r0 > 0.001 || a.r1 > 0.001) d = smin(d, roundConeD(p, a.s, a.h, a.r0, a.r1), 0.11)
  }
  return d
}

export function normalAt(b: Body, p: V3): V3 {
  const e = 0.0015
  const f = (x: number, y: number, z: number): number => bodyD(b, [p[0] + x, p[1] + y, p[2] + z])
  return unit([f(e, 0, 0) - f(-e, 0, 0), f(0, e, 0) - f(0, -e, 0), f(0, 0, e) - f(0, 0, -e)])
}

/** Where the surface is, looking along +Y at (u, v) from in front: the way the face is laid on the body (nk_sdf.surface_hits). */
export function surfaceHit(b: Body, u: number, v: number): { p: V3; n: V3 } {
  let y = -2.3
  for (let i = 0; i < 90; i += 1) {
    const d = bodyD(b, [u, y, v])
    if (d < 1e-5) break
    y += d
    if (y > 0.9) break
  }
  const p: V3 = [u, y, v]
  return { p, n: normalAt(b, p) }
}

/** A tangent frame at a normal: right (horizontal) and up, as nk_char.frame1. */
export function tangentFrame(n: V3): { r: V3; up: V3 } {
  const r = unit(cross([0, 0, 1], n))
  return { r, up: cross(n, r) }
}

// ------------------------------------------------------------------ the arms

/** The hand of an arm turned about its shoulder by `ang` radians in the picture plane (nk_char._swing). */
export function swing(arm: Arm, ang: number): Arm {
  if (!ang) return arm
  const dx = arm.h[0] - arm.s[0]
  const dz = arm.h[2] - arm.s[2]
  const c = Math.cos(ang)
  const si = Math.sin(ang)
  return { ...arm, h: [arm.s[0] + dx * c - dz * si, arm.h[1], arm.s[2] + dx * si + dz * c] }
}

export type ArmPose = 'down' | 'wave' | 'cheer' | 'think' | 'work' | 'worry' | 'sleep'

/** An arm that is not there: it has no radius, so nothing of it is drawn, and it can grow out of the body. */
export const NO_ARM: Arm = { s: [0, 0, 0], h: [0, -0.05, 0], r0: 0, r1: 0 }

/** The arms of a body in the poses the renders were made in (nk_char.arm_set); `wave` and `sway` as there. */
export function armsFor(kind: BodyKind, pose: ArmPose, wave = 0, sway = 0): [Arm, Arm] {
  if (kind === 'ucgen') {
    const raiseR: Arm = { s: [0.55, 0.0, -0.3], h: [1.18, -0.28, 0.35], r0: 0.21, r1: 0.15 }
    const raiseL: Arm = { s: [-0.55, 0.0, -0.3], h: [-1.18, -0.28, 0.35], r0: 0.21, r1: 0.15 }
    if (pose === 'wave') return [NO_ARM, swing(raiseR, wave)]
    if (pose === 'cheer') return [swing(raiseL, -sway), swing(raiseR, sway)]
    return [NO_ARM, NO_ARM]
  }
  const X = { nokta: 0.86, tavsan: 0.84, bulut: 1.02 }[kind]
  const Z0 = { nokta: -0.12, tavsan: -0.18, bulut: -0.2 }[kind]
  const hang = (sx: number): Arm => ({ s: [sx * (X - 0.02), -0.08, Z0 - 0.22], h: [sx * (X + 0.17), -0.18, Z0 - 0.42], r0: 0.19, r1: 0.178 })
  const raiseR: Arm = { s: [X * 0.92, 0.0, Z0 + 0.12], h: [X + 0.4, -0.3, Z0 + 0.74], r0: 0.2, r1: 0.235 }
  const raiseL: Arm = { s: [-X * 0.92, 0.0, Z0 + 0.12], h: [-(X + 0.4), -0.3, Z0 + 0.74], r0: 0.2, r1: 0.235 }
  switch (pose) {
    case 'wave':
      return [hang(-1), swing(raiseR, wave)]
    case 'cheer':
      return [swing(raiseL, -sway), swing(raiseR, sway)]
    case 'think':
      return [hang(-1), { s: [X * 0.86, -0.12, Z0 + 0.1], h: [0.55, -0.98, Z0 - 0.38], r0: 0.2, r1: 0.15 }]
    case 'work':
      return [hang(-1), { s: [X * 0.9, -0.05, Z0 + 0.05], h: [X + 0.46, -0.28, Z0 + 0.34], r0: 0.2, r1: 0.22 }]
    case 'worry':
      return [
        { s: [-X * 0.86, -0.1, Z0], h: [-0.72, -0.9, Z0 + 0.1], r0: 0.2, r1: 0.15 },
        { s: [X * 0.86, -0.1, Z0], h: [0.72, -0.9, Z0 + 0.1], r0: 0.2, r1: 0.15 },
      ]
    default:
      return [hang(-1), hang(1)]
  }
}

// ------------------------------------------------------------------ the face

/** An ellipsoid placed on the body: centre, right axis, up axis (the third is across them) and its three radii. */
export type EllFrame = { c: V3; r: V3; up: V3; n: V3; rx: number; ry: number; rz: number }

export type FaceParts = { eyes: [EllFrame, EllFrame]; lids: [EllFrame, EllFrame]; cheeks: [V3, V3]; nose: EllFrame | undefined }

/** How the face lies on the body for a look direction: the eyes' and lids' frames, the cheeks' centres, the nose. */
export function faceParts(b: Body, o: { look: readonly [number, number]; size: number; lid: number; lidTilt: number; blink: number }): FaceParts {
  const L = LAYOUT[b.kind]
  const eyes: EllFrame[] = []
  const lids: EllFrame[] = []
  const cheeks: V3[] = []
  const rx = L.rx * o.size
  const rz = L.rz * o.size
  for (const sx of [-1, 1]) {
    const hit = surfaceHit(b, sx * L.ex + 0.05 * o.look[0], L.ey + 0.05 * o.look[1])
    const { r, up } = tangentFrame(hit.n)
    const c = sub(hit.p, mul(hit.n, L.ry * 0.3))
    eyes.push({ c, r, up, n: hit.n, rx, ry: L.ry, rz: rz * (1 - 0.92 * o.blink) })
    const cs = Math.cos(sx * o.lidTilt)
    const sn = Math.sin(sx * o.lidTilt)
    const r2 = add(mul(r, cs), mul(up, sn))
    const up2 = sub(mul(up, cs), mul(r, sn))
    lids.push({ c: add(c, mul(up2, rz * (1 - o.lid))), r: r2, up: up2, n: hit.n, rx: rx * 1.1, ry: L.ry * 1.12, rz: rz * 1.02 })
    const ch = surfaceHit(b, sx * L.cheek[0], L.cheek[1])
    cheeks.push(sub(ch.p, mul(ch.n, 0.02)))
  }
  let nose: EllFrame | undefined
  if (b.kind === 'tavsan') {
    const hit = surfaceHit(b, 0, L.my + 0.15)
    const { r, up } = tangentFrame(hit.n)
    const rr = 0.052
    nose = { c: sub(hit.p, mul(hit.n, rr * 0.1)), r, up, n: hit.n, rx: rr * 1.25, ry: rr * 0.8, rz: rr * 0.9 }
  }
  return { eyes: eyes as [EllFrame, EllFrame], lids: lids as [EllFrame, EllFrame], cheeks: cheeks as [V3, V3], nose }
}

// ------------------------------------------------------------------ the accessories

export const BERET = { tilt: 0.25, x: -0.1, size: 1 }

/**
 * The accessory as the numbers the shader reads, ACC_SLOTS vec4s (nk_props.glasses / beret / bowtie).
 * Glasses: rim (centre, radius), rim axis, again for the other eye, the bridge (three points), each temple (three points).
 * Beret: its centre and tilt, its stem. Bow tie: its centre and the three axes of its frame.
 */
export function accessoryFrames(b: Body, acc: NoktaAccessory): number[] {
  const out = new Array<number>(14 * 4).fill(0)
  const put = (slot: number, v: V3, w = 0): void => {
    out[slot * 4] = v[0]
    out[slot * 4 + 1] = v[1]
    out[slot * 4 + 2] = v[2]
    out[slot * 4 + 3] = w
  }
  const L = LAYOUT[b.kind]
  if (acc === 'glasses') {
    const rad = L.rz * 1.36
    const sides = [-1, 1].map(sx => {
      const hit = surfaceHit(b, sx * L.ex, L.ey)
      const { r } = tangentFrame(hit.n)
      const c = add(add(hit.p, mul(hit.n, L.ry * 0.95 + 0.07)), [0, 0, 0.012])
      return { sx, c, n: hit.n, r }
    })
    const [l, r] = sides as [(typeof sides)[number], (typeof sides)[number]]
    put(0, l.c, rad)
    put(1, l.n)
    put(2, r.c, rad)
    put(3, r.n)
    const a = add(l.c, mul(l.r, rad))
    const c = sub(r.c, mul(r.r, rad))
    const mid = add(add(mul(add(a, c), 0.5), mul(add(l.n, r.n), 0.5 * 0.012)), [0, 0, 0.03])
    put(4, a)
    put(5, mid)
    put(6, c)
    sides.forEach((s, i) => {
      const start = add(s.c, mul(s.r, s.sx > 0 ? rad : -rad))
      const back = add(start, [s.sx * 0.14, 0.45, 0.02])
      put(7 + 3 * i, start)
      put(8 + 3 * i, add(mul(add(start, back), 0.5), [s.sx * 0.02, 0, 0]))
      put(9 + 3 * i, back)
    })
  } else if (acc === 'beret') {
    const top = TOP[b.kind] - 0.04 + (b.scale[2] - 1) * TOP[b.kind]
    put(0, [BERET.x, 0, top + 0.02], BERET.tilt)
    put(1, [BERET.x + Math.sin(BERET.tilt) * 0.3, 0, top + 0.02 + 0.3 * Math.cos(BERET.tilt)], BERET.tilt)
  } else if (acc === 'bowtie') {
    const hit = surfaceHit(b, 0, b.kind === 'nokta' ? -0.55 : -0.62)
    const { r, up } = tangentFrame(hit.n)
    put(0, add(hit.p, mul(hit.n, 0.035)))
    put(1, r)
    put(2, mul(hit.n, -1))
    put(3, up)
  }
  return out
}
