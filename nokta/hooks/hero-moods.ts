// What each mood looks like on the model: the face, the arms and the lean of the body (nk_char.FACE_STATES), and
// the key poses the Blender renders were made in (batch_anim.plan). The renders are the reference the live
// character is checked against; the same table is where the live motion aims.
// Pure code: no `$`, no browser.
import type { Frame, Look, Mouth } from './hero-frame'
import { myOf, restFrame } from './hero-frame'
import type { ArmPose } from './hero-model'
import { armsFor } from './hero-model'

export type Mood = 'neutral' | 'work' | 'ask' | 'approve' | 'happy' | 'worry' | 'sleep' | 'love'

export type EyeStyle = 'open' | 'wide' | 'focus' | 'happy' | 'sleep'
export type MouthKind = 'smile' | 'flat' | 'smirk' | 'wavy' | 'open' | 'o'

export type FaceState = {
  eyes: EyeStyle
  look: readonly [number, number]
  /** inner end up (left, right), lift (left, right) */
  brow: readonly [number, number, number, number]
  /** which eyes the brows follow (a sleeper keeps low brows, a happy face has none) */
  browAs?: EyeStyle
  mouth: readonly [MouthKind, number, number]
  pose: ArmPose
  tilt: number
  lid?: number
}

// The arms of 'work' and 'worry' stay down: that is how the renders show them (batch_anim.plan).
export const FACE_STATES: Record<Mood, FaceState> = {
  neutral: { eyes: 'open', look: [0, 0], brow: [0.03, 0.03, 0, 0], mouth: ['smile', 0.46, 0.13], pose: 'down', tilt: 0 },
  sleep: { eyes: 'sleep', look: [0, 0], brow: [-0.1, -0.1, -0.02, -0.02], mouth: ['o', 0.05, 0.065], pose: 'sleep', tilt: 0.14 },
  work: { eyes: 'focus', look: [0.85, -0.1], brow: [-0.2, -0.2, -0.02, -0.02], mouth: ['smirk', 0.3, 0.09], pose: 'down', tilt: -0.1 },
  ask: { eyes: 'wide', look: [0.25, 0.3], brow: [0, 0, 0.02, 0.11], mouth: ['o', 0.06, 0.075], pose: 'down', tilt: -0.16 },
  approve: { eyes: 'wide', look: [0, 0], brow: [0.25, 0.25, 0.05, 0.05], mouth: ['smile', 0.26, 0.1], pose: 'wave', tilt: 0 },
  happy: { eyes: 'happy', look: [0, 0], brow: [0, 0, 0, 0], mouth: ['open', 0.46, 0.34], pose: 'cheer', tilt: 0 },
  worry: { eyes: 'open', look: [0, -0.1], brow: [0.55, 0.55, 0.06, 0.06], mouth: ['wavy', 0.28, 0.05], pose: 'down', tilt: 0.08 },
  love: { eyes: 'happy', look: [0, 0], brow: [0, 0, 0, 0], mouth: ['open', 0.34, 0.2], pose: 'down', tilt: 0 },
}

/** A mouth of the renders (kind, then its two numbers) as the three fading shapes of the shader, at height `my`. */
export function mouthTarget(m: readonly [MouthKind, number, number], my: number): Mouth {
  const [kind, p1, p2] = m
  const none = {
    stroke: [0, p1 * 0.5, 0, 0] as const,
    strokeV0: my,
    strokeAlpha: 0,
    open: [0.23, 0.1, my + 0.1] as const,
    openAlpha: 0,
    round: [0.06, 0.075, my] as const,
    roundAlpha: 0,
  }
  switch (kind) {
    case 'open':
      return { ...none, open: [p1 * 0.5, p2 * 0.36, my + 0.1], openAlpha: 1 }
    case 'o':
      return { ...none, round: [p1, p2, my], roundAlpha: 1 }
    case 'flat':
      return { ...none, stroke: [0, p1 * 0.5, 0, 0], strokeV0: my + 0.004, strokeAlpha: 1 }
    case 'smirk':
      return { ...none, stroke: [p2, p1 * 0.5, 1, 0], strokeAlpha: 1 }
    case 'wavy':
      return { ...none, stroke: [0, p1 * 0.5, 0, p2], strokeAlpha: 1 }
    default:
      return { ...none, stroke: [p2, p1 * 0.5, 0, 0], strokeAlpha: 1 }
  }
}

/** A face state laid on a frame: the eyes, brows, mouth, arms and lean of the body. */
export function withFace(base: Frame, st: FaceState, o: { wave?: number; sway?: number; lid?: number; blush?: number } = {}): Frame {
  const size = st.eyes === 'wide' ? 1.12 : st.eyes === 'focus' ? 0.95 : 1
  const isBead = st.eyes === 'open' || st.eyes === 'wide' || st.eyes === 'focus'
  const brows = st.browAs ?? st.eyes
  const sleepBrow = brows === 'sleep'
  return {
    ...base,
    rot: [0, 0.03 + st.tilt * 0.5, -0.06],
    arms: armsFor(base.look.body, st.pose, o.wave ?? 0, o.sway ?? 0),
    blink: 0,
    beadOn: isBead ? 1 : 0,
    arcAlpha: isBead ? 0 : 1,
    arcH: st.eyes === 'happy' ? 0.085 : -0.05,
    gaze: st.look,
    lid: isBead ? (o.lid ?? st.lid ?? (st.eyes === 'focus' ? 0.16 : 0)) : 0,
    lidTilt: st.eyes === 'focus' ? 0.1 : 0,
    eyeSize: size,
    brow: sleepBrow ? [-0.12, -0.12, -0.04, -0.04] : st.brow,
    browAlpha: brows === 'happy' ? 0 : 1,
    mouth: mouthTarget(st.mouth, myOf(base.look.body)),
    blush: o.blush ?? 0.62,
  }
}

/** The 25 key poses of the renders (batch_anim.plan) as frames of the live model of `look`: `<mood>-<name>`. */
export function referenceFrames(look: Look): Record<string, Frame> {
  const base = restFrame(look)
  const F = (mood: Mood, o: Partial<FaceState> = {}, extra: Parameters<typeof withFace>[2] = {}): Frame => withFace(base, { ...FACE_STATES[mood], ...o }, extra)
  return {
    'neutral-open': F('neutral'),
    'neutral-half': F('neutral', {}, { lid: 0.55 }),
    'neutral-shut': F('neutral', { eyes: 'sleep', browAs: 'open' }),
    'neutral-left': F('neutral', { look: [-1.7, 0] }),
    'neutral-right': F('neutral', { look: [1.7, 0] }),
    'work-mid': F('work', { look: [0, -0.25] }),
    'work-left': F('work', { look: [-1.5, -0.25] }),
    'work-right': F('work', { look: [1.5, -0.25] }),
    'work-half': F('work', { look: [0, -0.25] }, { lid: 0.6 }),
    'work-shut': F('work', { eyes: 'sleep', browAs: 'focus' }),
    'ask-open': F('ask'),
    'ask-half': F('ask', {}, { lid: 0.5 }),
    'ask-shut': F('ask', { eyes: 'sleep', browAs: 'wide' }),
    'approve-w0': F('approve', {}, { wave: -0.3 }),
    'approve-w1': F('approve', {}, { wave: 0 }),
    'approve-w2': F('approve', {}, { wave: 0.3 }),
    'happy-a': F('happy', { mouth: ['open', 0.46, 0.34] }, { sway: 0.2, blush: 0.8 }),
    'happy-b': F('happy', { mouth: ['open', 0.46, 0.28] }, { sway: -0.2, blush: 0.8 }),
    'worry-a': F('worry', { mouth: ['wavy', 0.28, 0.05] }),
    'worry-b': F('worry', { mouth: ['wavy', 0.28, -0.05] }),
    'worry-shut': F('worry', { eyes: 'sleep', browAs: 'open' }),
    'sleep-a': F('sleep'),
    'sleep-b': F('sleep', { mouth: ['o', 0.062, 0.082] }),
    'love-a': F('love', {}, { blush: 0.95 }),
    'love-b': F('love', { mouth: ['open', 0.38, 0.26] }, { blush: 0.95 }),
  }
}
