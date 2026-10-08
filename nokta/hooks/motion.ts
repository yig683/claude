// The director: what Nokta does at a moment. For a mood and a time in seconds it picks which rendered picture of
// the 3D model to show (open eyes, a blink, the waving hand in one of three places ...) and how that picture
// is moved (breathing, bobbing, hopping, tilting), and it draws the small things that float around Nokta.
// Pure functions of time: the same moment always gives the same picture.
import type { NoktaMood } from '../types'
import { chain, circle, grow, group, move, picture, rad, turn, type Node } from './gfx'

/** The stage's own coordinates: a 240 x 240 square; the character stands at x = 120 with its feet on y = 186. */
export const CANVAS = 240
export const GROUND = 186
/** The stage units one scene unit of the 3D render takes: a body two units wide stands 128 wide on the stage. */
export const UNIT = 64

// ------------------------------------------------------------------ small maths

const TAU = Math.PI * 2
const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x))
const ease = (x: number): number => {
  const u = clamp(x)
  return u * u * (3 - 2 * u)
}
const sine = (t: number, period: number, phase = 0): number => Math.sin(TAU * (t / period + phase))
const frac = (x: number): number => x - Math.floor(x)
const mix = (a: number, b: number, k: number): number => a + (b - a) * k
const hash = (i: number): number => frac(Math.sin(i * 127.1 + 311.7) * 43758.5453)
/** 0 -> 1 -> 0 over u in 0..1, a flat-topped arch (so a fast blink still shows closed for a frame). */
const arch = (u: number): number => (u <= 0 || u >= 1 ? 0 : Math.pow(Math.sin(Math.PI * u), 0.5))

/** Keyframes [u, v1, v2, ...] ascending in u; smooth between neighbours. */
function keys(u: number, frames: readonly (readonly number[])[]): number[] {
  const x = clamp(u)
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1] as readonly number[]
    const b = frames[i] as readonly number[]
    if (x <= (b[0] as number)) {
      const k = ease((x - (a[0] as number)) / Math.max(1e-6, (b[0] as number) - (a[0] as number)))
      return a.slice(1).map((v, j) => mix(v, b[j + 1] as number, k))
    }
  }
  return (frames[frames.length - 1] as readonly number[]).slice(1)
}

function blinkAmount(t: number, period: number, seed: number): number {
  const i = Math.floor(t / period)
  const local = t - i * period
  const start = period * (0.5 + 0.28 * hash(i + seed))
  const dur = 0.3
  let c = arch((local - start) / dur)
  if (hash(i * 3.7 + seed + 5) > 0.78) c = Math.max(c, arch((local - start - 0.34) / dur))
  return c
}

/** A glance that moves now and then: steps between random spots, never far from the middle. */
function wander(t: number, seg: number, ax: number, ay: number, seed: number): [number, number] {
  const i = Math.floor(t / seg)
  const spot = (k: number): [number, number] =>
    hash(k + seed) > 0.45 ? [(hash(k * 1.7 + seed + 9) - 0.5) * 2 * ax, (hash(k * 2.3 + seed + 4) - 0.5) * 2 * ay] : [0, 0]
  const a = spot(i - 1)
  const b = spot(i)
  const u = ease((t - i * seg) / 0.35)
  return [mix(a[0], b[0], u), mix(a[1], b[1], u)]
}

/** A soft elliptical spot (a highlight, a blush, a shadow): a gradient on a unit circle, stretched. */
function soft(cx: number, cy: number, rx: number, ry: number, color: string, alpha: number, rot = 0, extra: Partial<Node> = {}): Node {
  return {
    shape: { k: 'ellipse', cx: 0, cy: 0, rx: 1, ry: 1 },
    fill: rad(0, 0, 1, [
      [0, color, alpha],
      [0.55, color, alpha * 0.5],
      [1, color, 0],
    ]),
    m: chain(move(cx, cy), turn(rot), grow(rx, ry)),
    ...extra,
  }
}


export type Lod = 'full' | 'small'

// ------------------------------------------------------------------ props

/** The small 3D things that float around Nokta (assets/props.json): a sprite's size is `half` scene units a side, halved. */
export type Sprites = Record<string, { half: number; w: string }>

const CONFETTI = ['confa', 'confb', 'confc', 'confd'] as const

/** One sprite placed on the stage: centred at (x, y), `scale` times its natural size, turned by `rot` degrees. */
function sprite(sprites: Sprites, name: string, x: number, y: number, scale: number, rot = 0, opacity = 1): Node | undefined {
  const one = sprites[name]
  if (one === undefined || opacity < 0.02 || scale <= 0) return undefined
  const side = 2 * one.half * UNIT * scale
  return picture(-side / 2, -side / 2, side, side, `data:image/webp;base64,${one.w}`, { m: chain(move(x, y), turn(rot)), opacity })
}

/** What floats around Nokta for a mood: typing dots, a "!" or "?", sparks, hearts, sleep. `a` fades the whole thing. */
function propNodes(mood: NoktaMood, t: number, a: number, lod: Lod, dy: number, sprites: Sprites | undefined): Node[] {
  if (a < 0.01 || sprites === undefined) return []
  const big = lod === 'full' ? 1 : 1.35
  const follow = dy * 0.45
  const out: (Node | undefined)[] = []
  switch (mood) {
    case 'work': {
      // a typing bubble, its three dots lifting one after another
      const x = 186
      const y = 52 + follow
      out.push(sprite(sprites, 'bubble', x, y, 1.0 * big, 0))
      for (let i = 0; i < 3; i += 1) {
        const up = Math.max(0, sine(t, 1.2, -i * 0.17))
        out.push(sprite(sprites, 'dot', x - 0.5 + (i - 1) * 17 * big, y - 1 - up * 5 * big, 0.42 * big, 0, 0.5 + 0.5 * up))
      }
      break
    }
    case 'approve': {
      const pulse = frac(t / 1.4)
      const x = 192
      const y = 58 + follow - 2.5 * Math.abs(sine(t, 0.75))
      out.push(circle(x, y, 20 + 14 * pulse, rad(x, y, 20 + 14 * pulse, [[0, '#E0603A', 0.34 * (1 - pulse)], [1, '#E0603A', 0]]), { opacity: 1 }))
      out.push(sprite(sprites, 'bang', x, y, 0.72 * big * (1 + 0.05 * sine(t, 0.75)), 4 * sine(t, 1.5)))
      break
    }
    case 'ask': {
      out.push(sprite(sprites, 'ask', 190, 58 + follow, 0.72 * big, 8 * sine(t, 1.6)))
      break
    }
    case 'happy': {
      const spots: ReadonlyArray<readonly [number, number, number, number]> = [
        [186, 56, 1.5, 0],
        [52, 72, 1.1, 0.33],
        [202, 120, 0.95, 0.62],
        [34, 122, 0.85, 0.8],
      ]
      for (const [x, y, s, ph] of spots) {
        const k = Math.max(0, sine(t, 1.3, ph))
        out.push(sprite(sprites, 'spark', x, y + follow * 0.4, s * 1.15 * (0.25 + 0.95 * k) * big, 20 * sine(t, 2.6, ph), 0.4 + 0.6 * k))
      }
      if (lod === 'full') {
        for (let i = 0; i < 12; i += 1) {
          const speed = 0.8 + 0.5 * hash(i + 40)
          const u = frac(t / (2.2 / speed) + hash(i + 9))
          const x = 30 + 180 * hash(i + 1) + 8 * Math.sin(u * 7 + i)
          const y = -10 + u * 212
          out.push(sprite(sprites, CONFETTI[i % CONFETTI.length] as string, x, y, 0.42 * (0.8 + 0.4 * hash(i + 17)), u * 520 * (hash(i + 3) > 0.5 ? 1 : -1), 1 - ease((u - 0.72) / 0.28)))
        }
      }
      break
    }
    case 'worry': {
      const slide = (x: number, y: number, k: number, s: number): Node | undefined =>
        sprite(sprites, 'drop', x, y + 26 * k, s * 0.5, 0, (1 - ease((k - 0.55) / 0.45)) * ease(k / 0.12))
      out.push(slide(176, 104, frac(t / 1.6), big), slide(64, 114, frac(t / 1.6 + 0.5), 0.8 * big))
      break
    }
    case 'sleep': {
      for (let i = 0; i < 3; i += 1) {
        const u = frac(t / 3.6 - i * 0.28)
        out.push(sprite(sprites, 'z', 168 + 30 * u, 82 - 46 * u, (0.36 + 0.36 * u) * big, -8 + 6 * u, ease(u / 0.2) * (1 - ease((u - 0.7) / 0.3))))
      }
      break
    }
    case 'love': {
      for (let i = 0; i < 4; i += 1) {
        const u = frac(t / 1.9 + i * 0.25)
        const x = 120 + (i % 2 === 0 ? -1 : 1) * (18 + 26 * u) + 8 * Math.sin(u * 6 + i)
        const y = 82 - 74 * u
        out.push(sprite(sprites, i % 2 === 0 ? 'heart' : 'heart2', x, y, (0.26 + 0.24 * ease(u / 0.4)) * big, 8 * Math.sin(u * 5 + i), ease(u / 0.12) * (1 - ease((u - 0.65) / 0.35))))
      }
      break
    }
    default:
      break
  }
  return [group(out, { opacity: a })]
}

// ------------------------------------------------------------------ the shot

/** One picture of the model, where it stands and how it is squeezed, for a moment. */
export type Shot = {
  /** `<mood>-<frame>`: the name of a rendered picture. */
  frame: string
  /** Offset on the stage (stage units), squash and stretch about the feet, tilt in degrees. */
  dx: number
  dy: number
  sx: number
  sy: number
  rot: number
}

const eyes = (blink: number): 'shut' | 'half' | undefined => (blink > 0.75 ? 'shut' : blink > 0.3 ? 'half' : undefined)

/** A mood's shot at time `t` seconds. */
export function shotOf(mood: NoktaMood, t: number): Shot {
  const breath = sine(t, 3.9)
  switch (mood) {
    case 'neutral': {
      const [gx] = wander(t, 3.3, 3.6, 1.6, 1)
      const closed = eyes(blinkAmount(t, 4.4, 3))
      // now and then a little wiggle, as a pet does when it is bored
      const wiggle = arch((frac(t / 11.3) - 0.91) / 0.09) * sine(t, 0.36)
      return {
        frame: `neutral-${closed ?? (gx < -1.7 ? 'left' : gx > 1.7 ? 'right' : 'open')}`,
        dx: wiggle * 1.2,
        dy: -5 + 3.3 * sine(t, 3.3),
        sx: 1 - 0.013 * breath,
        sy: 1 + 0.022 * breath,
        rot: 1.5 * sine(t, 6.2) + 3.6 * wiggle,
      }
    }
    case 'work': {
      const reading = [-4.5, -1.5, 2.5, 4.5, 1, -3] as const
      const at = Math.floor(t / 0.5)
      const now = reading[at % 6] as number
      const next = reading[(at + 1) % 6] as number
      const gx = mix(now, next, ease((frac(t / 0.5) - 0.78) / 0.22))
      const closed = eyes(blinkAmount(t, 4.2, 7))
      const bounce = Math.abs(sine(t, 0.9))
      return {
        frame: `work-${closed ?? (gx < -2.5 ? 'left' : gx > 2.5 ? 'right' : 'mid')}`,
        dx: 0,
        dy: -3 + 2.2 * bounce,
        sx: 1,
        sy: 1 - 0.014 * bounce,
        rot: 1.4 * sine(t, 1.8),
      }
    }
    case 'ask': {
      const closed = eyes(blinkAmount(t, 5, 11))
      return {
        frame: `ask-${closed ?? 'open'}`,
        dx: 0,
        dy: -3.5 + 2 * sine(t, 2.9),
        sx: 1,
        sy: 1,
        rot: 3.4 * sine(t, 2.6),
      }
    }
    case 'approve': {
      const wave = sine(t, 0.62)
      const u = frac(t / 1.5)
      const hop = Math.max(0, Math.sin(Math.PI * clamp((u - 0.05) / 0.3)))
      return {
        frame: `approve-${wave < -0.4 ? 'w0' : wave > 0.4 ? 'w2' : 'w1'}`,
        dx: 0,
        dy: -3 - 7 * hop,
        sx: 1 - 0.02 * hop,
        sy: 1 + 0.03 * hop,
        rot: -1.5,
      }
    }
    case 'happy': {
      const u = frac(t / 1.3)
      const [dy, sx, sy] = keys(u, [
        [0, 0, 1, 1],
        [0.14, 0, 1.1, 0.88],
        [0.28, -8, 0.93, 1.13],
        [0.45, -33, 0.97, 1.05],
        [0.62, -6, 1, 1],
        [0.7, 0, 1.12, 0.86],
        [0.84, 0, 0.98, 1.03],
        [1, 0, 1, 1],
      ]) as [number, number, number]
      return { frame: `happy-${sine(t, 0.65) > 0 ? 'a' : 'b'}`, dx: 0, dy, sx, sy, rot: 2.4 * sine(t, 1.3) }
    }
    case 'worry': {
      const k = Math.floor(t * 14)
      const jit = (a: number): number => (hash(k * 1.3 + a) - 0.5) * 2
      const closed = blinkAmount(t, 3.6, 19) > 0.5
      return {
        frame: `worry-${closed ? 'shut' : hash(Math.floor(t * 6) + 5) > 0.5 ? 'a' : 'b'}`,
        dx: 1.5 * jit(1),
        dy: -2 + 0.9 * jit(2),
        sx: 1.015,
        sy: 0.975,
        rot: 0.9 * jit(3),
      }
    }
    case 'sleep': {
      const slow = sine(t, 4.4)
      return {
        frame: `sleep-${slow > 0 ? 'b' : 'a'}`,
        dx: 0,
        dy: 3 + 1.4 * slow,
        sx: 1 - 0.015 * slow,
        sy: 1 + 0.03 * slow,
        rot: 1.2 * slow,
      }
    }
    case 'love': {
      const beat = frac(t / 0.9)
      const pulse = Math.max(arch(beat / 0.28), 0.6 * arch((beat - 0.3) / 0.28))
      return {
        frame: `love-${pulse > 0.5 ? 'b' : 'a'}`,
        dx: 0,
        dy: -4 + 2.6 * sine(t, 1.1),
        sx: 1 + 0.045 * pulse,
        sy: 1 + 0.045 * pulse,
        rot: 5.5 * sine(t, 0.64),
      }
    }
  }
}

/** Two shots blended, for the moment Nokta changes mood: the moves are mixed, the picture is the new one's. */
export function blendShots(a: Shot, b: Shot, k: number): Shot {
  const u = ease(k)
  return { frame: b.frame, dx: mix(a.dx, b.dx, u), dy: mix(a.dy, b.dy, u), sx: mix(a.sx, b.sx, u), sy: mix(a.sy, b.sy, u), rot: mix(a.rot, b.rot, u) }
}

/** Every picture a mood can ask for (what the render must hold for each look). */
export const FRAMES: Record<NoktaMood, readonly string[]> = {
  neutral: ['open', 'half', 'shut', 'left', 'right'],
  work: ['mid', 'left', 'right', 'half', 'shut'],
  ask: ['open', 'half', 'shut'],
  approve: ['w0', 'w1', 'w2'],
  happy: ['a', 'b'],
  worry: ['a', 'b', 'shut'],
  sleep: ['a', 'b'],
  love: ['a', 'b'],
}

// ------------------------------------------------------------------ the stage

/** A soft glow and floor under the character, in its own colour. `span` is the width shown, in stage units. */
export function stageNodes(glow: string, span: number): Node[] {
  return [soft(120, 128, Math.min(span / 2, 170), 124, glow, 0.18), soft(120, 207, Math.min(span / 2.2, 120), 16, glow, 0.2)]
}

/** The shadow on the floor: it shrinks and fades as Nokta rises (`dy` negative), and follows its width. */
export function shadowNode(dy: number, width: number): Node {
  const lift = clamp(-dy / 40, 0, 1.2)
  return soft(120, GROUND + 20, width * (1 - 0.28 * lift), 9.5 * (1 - 0.25 * lift), '#000000', 0.34 * (1 - 0.5 * lift))
}

/** The small things around a mood, drawn on top; `a` fades them all (for a change of mood). */
export function propsOf(mood: NoktaMood, t: number, a: number, lod: Lod, dy: number, sprites: Sprites | undefined): Node[] {
  return propNodes(mood, t, a, lod, dy, sprites)
}
