// Nokta's pictures as pure functions: the rendered 3D pictures (assets/looks) placed, moved and dressed into an
// SVG for the apps, and cut into terminal cells. (Reading the files is the hooks module's job: it alone touches `$`.)
import type { NoktaColor, NoktaLook, NoktaMood } from '../types'
import { blendShots, CANVAS, GROUND, propsOf, shadowNode, shotOf, stageNodes, UNIT, type Lod, type Shot, type Sprites } from './motion'
import { chain, grow, group, move, picture, toSvg, turn, type Node } from './gfx'
import { MOOD } from './model'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 of bytes. (The environment has no Buffer, and `toBase64` is not everywhere.) */
export function b64encode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }
  return out
}

export function b64decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean.charAt(i))
    const b = B64.indexOf(clean.charAt(i + 1))
    const c = i + 2 < clean.length ? B64.indexOf(clean.charAt(i + 2)) : -1
    const d = i + 3 < clean.length ? B64.indexOf(clean.charAt(i + 3)) : -1
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d)
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (c >= 0 && o < out.length) out[o++] = (n >> 8) & 255
    if (d >= 0 && o < out.length) out[o++] = n & 255
  }
  return out
}

/** Pixels (RGBA, row-major) to half-block cells: `▀` and `▄`, the top and bottom pixel as two colours. */
export function rasterCells(rgba: Uint8Array, width: number, height: number): string {
  const columns = width
  const rows = Math.ceil(height / 2)
  const bytes = new Uint8Array(columns * rows * 12)
  const DEFAULT = 0x01000000
  const pixel = (x: number, y: number): number | undefined => {
    if (y >= height) return undefined
    const i = (y * width + x) * 4
    if ((rgba[i + 3] ?? 0) < 128) return undefined
    return ((rgba[i] ?? 0) << 16) | ((rgba[i + 1] ?? 0) << 8) | (rgba[i + 2] ?? 0)
  }
  const put = (at: number, value: number): void => {
    bytes[at] = value & 255
    bytes[at + 1] = (value >>> 8) & 255
    bytes[at + 2] = (value >>> 16) & 255
    bytes[at + 3] = (value >>> 24) & 255
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const top = pixel(c, 2 * r)
      const bottom = pixel(c, 2 * r + 1)
      let code = 0x20
      let fg = DEFAULT
      let bg = DEFAULT
      if (top !== undefined && bottom !== undefined) {
        code = 0x2580
        fg = top
        bg = bottom
      } else if (top !== undefined) {
        code = 0x2580
        fg = top
      } else if (bottom !== undefined) {
        code = 0x2584
        fg = bottom
      }
      const o = (r * columns + c) * 12
      put(o, code)
      put(o + 4, fg)
      put(o + 8, bg)
    }
  }
  return b64encode(bytes)
}

/** What assets/looks/<look>.json holds: the rendered pictures of one look. */
export type FramePack = {
  /** Scene units across half the picture (a Nokta body is about two units wide). */
  half: number
  /** The silhouette of the resting pose, as fractions of the picture: x0, y0, x1, y1. */
  box: readonly [number, number, number, number]
  /** `<mood>-<frame>`: base64 WebP (the big picture, the small one) and the 24 x 24 RGBA pixels for terminal cells. */
  frames: Record<string, { h: string; s: string; c: string }>
}

/** Whether a parsed file is a set of sprites we can draw from. */
export function isSprites(value: unknown): value is Sprites {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every(one => typeof one === 'object' && one !== null && typeof (one as { half?: unknown }).half === 'number' && typeof (one as { w?: unknown }).w === 'string')
}

/** Whether a parsed file is a pack we can draw from. */
export function isPack(value: unknown): value is FramePack {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<FramePack>
  return typeof v.half === 'number' && Array.isArray(v.box) && v.box.length === 4 && typeof v.frames === 'object' && v.frames !== null
}

/** What the picture shows at a moment: the mood, seconds since the animation began, a change of mood in progress. */
export type Moment = { mood: NoktaMood; t: number; from?: { mood: NoktaMood; k: number } }

/** The most an Svg's source may hold is 131072 characters; a tree past it is refused whole. */
export const SVG_ROOM = 120_000

/** A mood's glow: the look's own warm colour, light enough to read on a dark surface. */
const GLOW: Record<NoktaColor, string> = {
  clay: '#EC7F5E',
  sky: '#79B2E8',
  sage: '#9ECC90',
  kraft: '#E2B97E',
  ink: '#8E97C0',
  peach: '#FFC6A8',
}

/** How much of its natural size each body is drawn at, so a tall cloud or a long-eared rabbit still fits the stage. */
const FIT: Record<NoktaLook['body'], number> = { nokta: 1, bulut: 0.84, tavsan: 0.78, ucgen: 0.8 }

/** The shot a moment asks for, its change of mood folded in. `over` is the new picture fading in over `under`. */
function shotsAt(at: Moment): { shot: Shot; under?: Shot; k: number } {
  const now = shotOf(at.mood, at.t)
  if (at.from === undefined || at.from.k >= 1) return { shot: now, k: 1 }
  const before = shotOf(at.from.mood, at.t)
  return { shot: blendShots(before, now, at.from.k), under: before, k: Math.max(0, at.from.k) }
}

/** One picture of the pack, placed so the feet stand on the stage's ground and moved as `shot` says. */
function placed(pack: FramePack, shot: Shot, frame: string, size: 'h' | 's', opacity: number, fit: number): Node | undefined {
  const f = pack.frames[frame]
  if (f === undefined) return undefined
  const side = 2 * pack.half * UNIT * fit
  const ax = (pack.box[0] + pack.box[2]) / 2
  const ay = pack.box[3]
  const m = chain(move(shot.dx, shot.dy), turn(shot.rot, 120, GROUND), grow(shot.sx, shot.sy, 120, GROUND))
  return picture(120 - ax * side, GROUND - ay * side, side, side, `data:image/webp;base64,${f[size]}`, { m, opacity })
}

function figureNodes(look: NoktaLook, pack: FramePack, at: Moment, size: 'h' | 's', lod: Lod, isStaged: boolean, span: number, sprites: Sprites | undefined): Node[] {
  const fit = FIT[look.body] ?? 1
  const glow = GLOW[look.color]
  const { shot: raw, under: rawUnder, k } = shotsAt(at)
  // the moves shrink with the body, or a small rabbit would hop as high as a big dot
  const shot = { ...raw, dx: raw.dx * fit, dy: raw.dy * fit }
  const under = rawUnder === undefined ? undefined : { ...rawUnder, dx: rawUnder.dx * fit, dy: rawUnder.dy * fit }
  const bodyWidth = (pack.box[2] - pack.box[0]) * 2 * pack.half * UNIT * fit
  const nodes: Node[] = []
  if (isStaged) nodes.push(...stageNodes(glow, span))
  nodes.push(shadowNode(shot.dy, bodyWidth * 0.42))
  // the old picture stays whole under the new one while that fades in: no moment with a hole in Nokta
  if (under !== undefined) {
    const old = placed(pack, shot, under.frame, size, 1, fit)
    if (old !== undefined) nodes.push(old)
  }
  const fresh = placed(pack, shot, shot.frame, size, under === undefined ? 1 : k, fit)
  if (fresh !== undefined) nodes.push(fresh)
  if (at.from !== undefined && at.from.k < 1) {
    nodes.push(...propsOf(at.from.mood, at.t, 1 - at.from.k, lod, shot.dy, sprites), ...propsOf(at.mood, at.t, at.from.k, lod, shot.dy, sprites))
  } else {
    nodes.push(...propsOf(at.mood, at.t, 1, lod, shot.dy, sprites))
  }
  return nodes
}

/** Nokta small (the band's, the speaker label's): the small pictures, props a little larger so they read. */
export function avatarSvg(look: NoktaLook, pack: FramePack, at: Moment, px: number, sprites?: Sprites): string {
  const nodes = figureNodes(look, pack, at, 's', 'small', false, CANVAS, sprites)
  return toSvg(group(nodes), {
    viewBox: [28, 12, 196, 196],
    width: px,
    height: px,
    prefix: 'a',
    title: `${look.name}: ${MOOD[at.mood].label}`,
  })
}

/** The part of the stage the hero shows: from the props above the head to the shadow on the floor. */
const HERO_TOP = 6
const HERO_ROWS = 222

/** The pane's top picture in the apps: Nokta on a soft stage, `width` x `height` pixels. */
export function heroSvg(look: NoktaLook, pack: FramePack, at: Moment, width: number, height: number, sprites?: Sprites): string {
  const scale = height / HERO_ROWS
  const span = width / scale
  const title = `${look.name}: ${MOOD[at.mood].label}`
  const draw = (size: 'h' | 's'): string =>
    toSvg(group(figureNodes(look, pack, at, size, 'full', true, span, sprites)), {
      viewBox: [(CANVAS - span) / 2, HERO_TOP, span, HERO_ROWS],
      width,
      height,
      prefix: 'h',
      title,
    })
  const source = draw('h')
  // a picture past the limit would be refused whole: the small one still shows Nokta
  return source.length <= SVG_ROOM ? source : draw('s')
}

/** Terminal cells (24 columns, 12 rows of half blocks) of one picture of the pack; `undefined` if it has none. */
export function terminalCells(pack: FramePack, frame: string): { cells: string; columns: number; rows: number } | undefined {
  const f = pack.frames[frame]
  if (f === undefined) return undefined
  const size = Math.round(Math.sqrt(b64decode(f.c).length / 4))
  return { cells: rasterCells(b64decode(f.c), size, size), columns: size, rows: Math.ceil(size / 2) }
}
