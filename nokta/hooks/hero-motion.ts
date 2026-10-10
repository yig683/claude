// Nokta's live motion: nothing here picks a picture. Every number the model is drawn from (the lean of the body,
// where each hand is, how far each eyelid is down, the curve of the mouth) is a spring that is pulled towards what
// the mood asks for, and on top of the springs ride the things that never stop: breath, bobbing, blinks, glances,
// the wave of a hand, a hop. The same mood at the same moment always gives the same frame.
// Pure code: no `$`, no browser.
import type { Frame, Look } from './hero-frame'
import { restFrame } from './hero-frame'
import type { Mood } from './hero-moods'
import { FACE_STATES, withFace } from './hero-moods'
import type { Arm, BodyKind } from './hero-model'
import { swing } from './hero-model'
import { blendShots, blinkAmount, clamp, ease, mix, shotOf, sine, UNIT, wander } from './motion'

/** How the numbers are laid out in the flat vector the springs work on. */
const I = {
  rot: 0,
  loc: 3,
  scale: 6,
  armLS: 9,
  armLH: 12,
  armLR: 15,
  armRS: 17,
  armRH: 20,
  armRR: 23,
  arcH: 25,
  look: 26,
  lidTilt: 28,
  eyeSize: 29,
  brow: 30,
  browAlpha: 34,
  stroke: 35,
  strokeV0: 39,
  strokeAlpha: 40,
  open: 41,
  openAlpha: 44,
  round: 45,
  roundAlpha: 48,
  blush: 49,
  eyeOpen: 50,
  stateLid: 51,
} as const
const N = 52

/**
 * The spring of each number: how fast it follows (rad/s) and how much it overshoots (1 critical, below 1 bouncy),
 * and the time (s) a soft start takes. A spring pulled towards a new target is quickest at the first instant, which
 * shows as a jump of a hand from one frame to the next; the target is therefore eased in first, so that the move
 * starts slowly, gathers speed and settles with the spring's own follow-through.
 */
function springs(): { w: Float64Array; z: Float64Array; tau: Float64Array } {
  const w = new Float64Array(N).fill(18)
  const z = new Float64Array(N).fill(1)
  const tau = new Float64Array(N).fill(0.03)
  const group = (from: number, count: number, omega: number, zeta: number, soft: number): void => {
    for (let i = from; i < from + count; i += 1) {
      w[i] = omega
      z[i] = zeta
      tau[i] = soft
    }
  }
  group(I.rot, 9, 14, 1, 0.05)
  group(I.armLS, 8, 22, 0.72, 0.075)
  group(I.armRS, 8, 22, 0.72, 0.075)
  group(I.arcH, 1, 22, 1, 0.03)
  group(I.look, 2, 26, 1, 0.02)
  group(I.lidTilt, 2, 20, 1, 0.03)
  group(I.brow, 5, 20, 0.85, 0.03)
  group(I.stroke, 14, 17, 0.85, 0.035)
  group(I.blush, 1, 7, 1, 0.03)
  group(I.eyeOpen, 2, 22, 1, 0.02)
  return { w, z, tau }
}
const SPRING = springs()

function toVec(f: Frame, out = new Float64Array(N)): Float64Array {
  out.set(f.rot, I.rot)
  out.set(f.loc, I.loc)
  out.set(f.scale, I.scale)
  const [l, r] = f.arms
  out.set(l.s, I.armLS)
  out.set(l.h, I.armLH)
  out[I.armLR] = l.r0
  out[I.armLR + 1] = l.r1
  out.set(r.s, I.armRS)
  out.set(r.h, I.armRH)
  out[I.armRR] = r.r0
  out[I.armRR + 1] = r.r1
  out[I.arcH] = f.arcH
  out.set(f.gaze, I.look)
  out[I.lidTilt] = f.lidTilt
  out[I.eyeSize] = f.eyeSize
  out.set(f.brow, I.brow)
  out[I.browAlpha] = f.browAlpha
  out.set(f.mouth.stroke, I.stroke)
  out[I.strokeV0] = f.mouth.strokeV0
  out[I.strokeAlpha] = f.mouth.strokeAlpha
  out.set(f.mouth.open, I.open)
  out[I.openAlpha] = f.mouth.openAlpha
  out.set(f.mouth.round, I.round)
  out[I.roundAlpha] = f.mouth.roundAlpha
  out[I.blush] = f.blush
  out[I.eyeOpen] = f.beadOn
  out[I.stateLid] = f.lid
  return out
}

type V3 = [number, number, number]

function armOf(x: Float64Array, s: number, h: number, r: number): Arm {
  return { s: [x[s] as number, x[s + 1] as number, x[s + 2] as number], h: [x[h] as number, x[h + 1] as number, x[h + 2] as number], r0: x[r] as number, r1: x[r + 1] as number }
}

const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** How far below the middle of each body its feet are: the motion scales and turns about them, not about the middle. */
const FEET: Record<BodyKind, number> = { nokta: 0.95, bulut: 1.02, tavsan: 0.92, ucgen: 0.96 }

export type Anim = {
  look: Look
  /** seconds since it began */
  t: number
  mood: Mood
  from: Mood
  /** seconds since the mood last changed */
  since: number
  x: Float64Array
  v: Float64Array
  /** where the numbers are asked to go, eased: the springs chase this, not the mood's own numbers */
  goal: Float64Array
  isFirst: boolean
  /** the ears of the rabbit hang from the body: a loose spring of their own, and where the body was a moment ago */
  ear: number
  earV: number
  lastX: number
  /** where the glance is now: it eases towards where it is asked to go */
  glx: number
  glz: number
}

export function newAnim(look: Look, mood: Mood = 'neutral'): Anim {
  return {
    look,
    t: 0,
    mood,
    from: mood,
    since: 99,
    x: new Float64Array(N),
    v: new Float64Array(N),
    goal: new Float64Array(N),
    isFirst: true,
    ear: 0,
    earV: 0,
    lastX: 0,
    glx: 0,
    glz: 0,
  }
}

/** Time the stillness is shown at: eyes open, mid-breath. */
export const STILL_T = 0.4
/** Seconds a change of mood takes to show in the body and in what rides on the springs. */
const CHANGE_S = 0.4

/** The glance of a mood at a moment, in the units of the face (what `gaze` takes). */
function gaze(mood: Mood, t: number): [number, number] {
  if (mood === 'neutral') {
    const [gx, gy] = wander(t, 3.3, 3.6, 1.6, 1)
    return [gx * 0.5, gy * 0.5]
  }
  if (mood === 'work') {
    const reading = [-4.5, -1.5, 2.5, 4.5, 1, -3]
    const at = Math.floor(t / 0.5)
    const now = reading[at % 6] as number
    const next = reading[(at + 1) % 6] as number
    const f = t / 0.5 - Math.floor(t / 0.5)
    return [mix(now, next, ease((f - 0.78) / 0.22)) * 0.35, 0]
  }
  return [0, 0]
}

/** How shut the eyes are for a blink, 0 open .. 1 closed; only the moods with open eyes blink. */
function blinkOf(mood: Mood, t: number): number {
  switch (mood) {
    case 'neutral':
      return blinkAmount(t, 4.4, 3)
    case 'work':
      return blinkAmount(t, 4.2, 7)
    case 'ask':
      return blinkAmount(t, 5, 11)
    case 'worry':
      return blinkAmount(t, 3.6, 19)
    default:
      return 0
  }
}

/** Moves the whole thing by `dt` seconds towards `mood` and returns the frame to draw. */
export function stepAnim(
  a: Anim,
  dt: number,
  mood: Mood,
  isStill = false,
  /** where the eyes are asked to look instead of wandering (the pointer), in the units of `gaze` */
  looking?: readonly [number, number],
): { frame: Frame; dy: number; blink: number } {
  if (mood !== a.mood) {
    a.from = a.mood
    a.mood = mood
    a.since = 0
  }
  a.t += dt
  a.since += dt
  const t = isStill ? STILL_T : a.t
  const base = restFrame(a.look)
  const target = toVec(withFace(base, FACE_STATES[mood]))
  if (a.isFirst || isStill) {
    // a still Nokta is in the pose of its mood, whole, at once: a picture drawn once must not be one taken half way
    a.x.set(target)
    a.goal.set(target)
    a.v.fill(0)
    a.isFirst = false
  } else {
    // semi-implicit Euler in small steps keeps a spring stable at any frame rate
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    const h = dt / steps
    for (let s = 0; s < steps; s += 1) {
      for (let i = 0; i < N; i += 1) {
        const w = SPRING.w[i] as number
        const z = SPRING.z[i] as number
        const goal = (a.goal[i] as number) + ((target[i] as number) - (a.goal[i] as number)) * (1 - Math.exp(-h / (SPRING.tau[i] as number)))
        a.goal[i] = goal
        const acc = w * w * (goal - (a.x[i] as number)) - 2 * z * w * (a.v[i] as number)
        a.v[i] = (a.v[i] as number) + acc * h
        a.x[i] = (a.x[i] as number) + (a.v[i] as number) * h
      }
    }
  }
  const x = a.x

  // the body: the springs hold its lean; the shot of the mood (breath, bob, hop) rides on it, mixed while the mood changes
  const k = isStill ? 1 : clamp(a.since / CHANGE_S)
  const now = shotOf(mood, t)
  const shot = k >= 1 || a.from === mood ? now : blendShots(shotOf(a.from, t), now, k)
  const phi = (shot.rot * Math.PI) / 180
  const feet = FEET[a.look.body]
  const rot: V3 = [x[I.rot] as number, (x[I.rot + 1] as number) + phi, (x[I.rot + 2] as number) + 0.02 * (x[I.look] as number)]
  const scale: V3 = [(x[I.scale] as number) * shot.sx, (x[I.scale + 1] as number) * shot.sx, (x[I.scale + 2] as number) * shot.sy]
  // turning and scaling about the feet: the middle of the body moves, the feet stay where they stood
  const loc: V3 = [
    (x[I.loc] as number) + shot.dx / UNIT + feet * Math.sin(phi),
    x[I.loc + 1] as number,
    (x[I.loc + 2] as number) - shot.dy / UNIT + feet * (Math.cos(phi) - 1) + feet * (shot.sy - 1),
  ]

  // the ears hang on a loose spring that the body's sideways movement shakes
  const vx = dt > 0 ? (loc[0] - a.lastX) / dt : 0
  a.lastX = loc[0]
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
  const h = dt / steps
  for (let s = 0; s < steps; s += 1) {
    a.earV += (-110 * a.ear - 7 * a.earV - vx * 14) * h
    a.ear += a.earV * h
  }
  a.ear = clamp(a.ear, -0.2, 0.2)

  // the face: the springs hold the expression; glances, blinks and wobbles ride on it
  const w = ease(k)
  const [tx, tz] = looking ?? gaze(mood, t)
  const ease_ = dt > 0 ? 1 - Math.exp(-dt * 14) : 1
  a.glx += (tx - a.glx) * ease_
  a.glz += (tz - a.glz) * ease_
  const glance: [number, number] = [(x[I.look] as number) + a.glx * w, (x[I.look + 1] as number) + a.glz * w]
  const blink = isStill ? 0 : blinkOf(mood, t) * w
  const open = clamp(x[I.eyeOpen] as number) * (1 - blink)
  const closing = 1 - open
  const lid = clamp(Math.max(x[I.stateLid] as number, closing * 1.05), 0, 0.97)
  const arcAlpha = smooth(0.8, 0.97, closing)
  const beadOn = closing < 0.93 ? 1 : 0

  // arms: the hands of the springs, and the swing of a wave or a cheer on top
  let la = armOf(x, I.armLS, I.armLH, I.armLR)
  let ra = armOf(x, I.armRS, I.armRH, I.armRR)
  if (!isStill) {
    if (mood === 'approve') ra = swing(ra, 0.3 * sine(t, 0.62) * w)
    if (mood === 'happy') {
      const sway = 0.2 * sine(t, 1.3) * w
      la = swing(la, -sway)
      ra = swing(ra, sway)
    }
  }

  // the mouth: the shapes of the springs, and the small changes that go with a mood
  const stroke: [number, number, number, number] = [x[I.stroke] as number, x[I.stroke + 1] as number, x[I.stroke + 2] as number, x[I.stroke + 3] as number]
  const open3: [number, number, number] = [x[I.open] as number, x[I.open + 1] as number, x[I.open + 2] as number]
  const round3: [number, number, number] = [x[I.round] as number, x[I.round + 1] as number, x[I.round + 2] as number]
  if (!isStill) {
    if (mood === 'worry') stroke[3] = (x[I.stroke + 3] as number) + 0.05 * sine(t, 0.35) * w
    if (mood === 'happy') open3[1] = (x[I.open + 1] as number) + 0.011 * sine(t, 1.3) * w
    if (mood === 'love') {
      const pulse = Math.max(0, sine(t, 0.9))
      open3[0] = (x[I.open] as number) + 0.02 * pulse * w
      open3[1] = (x[I.open + 1] as number) + 0.02 * pulse * w
    }
    if (mood === 'sleep') {
      const slow = sine(t, 4.4)
      round3[0] = (x[I.round] as number) + 0.006 * slow * w
      round3[1] = (x[I.round + 1] as number) + 0.0085 * slow * w
    }
  }

  const frame: Frame = {
    ...base,
    rot,
    loc,
    scale,
    arms: [la, ra],
    earSway: isStill ? 0 : a.ear,
    blink: 0,
    beadOn,
    arcAlpha,
    arcH: x[I.arcH] as number,
    gaze: glance,
    lid,
    lidTilt: x[I.lidTilt] as number,
    eyeSize: x[I.eyeSize] as number,
    brow: [x[I.brow] as number, x[I.brow + 1] as number, x[I.brow + 2] as number, x[I.brow + 3] as number],
    browAlpha: clamp(x[I.browAlpha] as number),
    mouth: {
      stroke,
      strokeV0: x[I.strokeV0] as number,
      strokeAlpha: clamp(x[I.strokeAlpha] as number),
      open: open3,
      openAlpha: clamp(x[I.openAlpha] as number),
      round: round3,
      roundAlpha: clamp(x[I.roundAlpha] as number),
    },
    blush: x[I.blush] as number,
  }
  return { frame, dy: shot.dy, blink }
}
