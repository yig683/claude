// Nokta's pictures, as pure functions: the 3D renders the mod ships (assets/icons, assets/raster.json)
// as terminal cells and as SVG. (Reading the files is the hooks module's job: it alone touches `$`.)
// Everything degrades: no asset on disk, a surface that scrubs <image>: the vector Nokta underneath still shows.
import type { NoktaLook, NoktaMood } from '../types'
import { clip, MOOD } from './model'

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

/** What assets/raster.json holds: every icon as a small RGBA picture, and the largest disc inside its silhouette. */
export type RasterPack = {
  width: number
  height: number
  /** Base64 of `width * height` RGBA pixels, per icon key. */
  rgba: Record<string, string>
  /** [cx, cy, r] of a disc that lies wholly inside the render's silhouette, as fractions of the picture. */
  disc: Record<string, [number, number, number]>
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

/** Escapes text for an XML attribute or element. */
export function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const BODY_FILL: Record<string, string> = {
  clay: '#E8A07E',
  sky: '#9DBBD3',
  sage: '#A6C0A0',
  kraft: '#D3B08A',
  ink: '#4A4743',
  peach: '#F2B9A0',
}

/** Eyes and mouth of the vector Nokta, per mood, on a disc of radius 1 around its centre. */
function vectorFace(mood: NoktaMood, ink: string): string {
  const eye = (x: number): string =>
    `<ellipse cx="${x}" cy="-0.08" rx="0.085" ry="0.12" fill="${ink}"/>`
  switch (mood) {
    case 'happy':
      return (
        `<path d="M-0.42 -0.06 Q-0.3 -0.24 -0.18 -0.06" stroke="${ink}" stroke-width="0.07" fill="none" stroke-linecap="round"/>` +
        `<path d="M0.18 -0.06 Q0.3 -0.24 0.42 -0.06" stroke="${ink}" stroke-width="0.07" fill="none" stroke-linecap="round"/>` +
        `<path d="M-0.16 0.2 Q0 0.4 0.16 0.2 Z" fill="${ink}"/>`
      )
    case 'sleep':
      return (
        `<path d="M-0.42 -0.06 Q-0.3 0.04 -0.18 -0.06" stroke="${ink}" stroke-width="0.07" fill="none" stroke-linecap="round"/>` +
        `<path d="M0.18 -0.06 Q0.3 0.04 0.42 -0.06" stroke="${ink}" stroke-width="0.07" fill="none" stroke-linecap="round"/>` +
        `<ellipse cx="0" cy="0.26" rx="0.05" ry="0.04" fill="${ink}"/>`
      )
    case 'worry':
      return (
        eye(-0.3) + eye(0.3) +
        `<path d="M-0.14 0.3 Q0 0.2 0.14 0.3" stroke="${ink}" stroke-width="0.06" fill="none" stroke-linecap="round"/>`
      )
    case 'ask':
      return eye(-0.3) + eye(0.3) + `<ellipse cx="0" cy="0.27" rx="0.06" ry="0.07" fill="${ink}"/>`
    case 'approve':
      return (
        eye(-0.3) + eye(0.3) +
        `<path d="M-0.14 0.22 Q0 0.36 0.14 0.22" stroke="${ink}" stroke-width="0.06" fill="none" stroke-linecap="round"/>`
      )
    case 'work':
      return (
        `<path d="M-0.42 -0.08 L-0.18 -0.08" stroke="${ink}" stroke-width="0.07" stroke-linecap="round"/>` +
        `<path d="M0.18 -0.08 L0.42 -0.08" stroke="${ink}" stroke-width="0.07" stroke-linecap="round"/>` +
        `<path d="M-0.1 0.26 L0.1 0.26" stroke="${ink}" stroke-width="0.06" stroke-linecap="round"/>`
      )
    default:
      return (
        eye(-0.3) + eye(0.3) +
        `<path d="M-0.14 0.22 Q0 0.32 0.14 0.22" stroke="${ink}" stroke-width="0.06" fill="none" stroke-linecap="round"/>`
      )
  }
}

/** A mood's little prop (what the renders leave out): drawn in a 100 x 100 box, top right. */
function badge(mood: NoktaMood, animated: boolean): string {
  const color = MOOD[mood].color
  const a = (inner: string): string => (animated ? inner : '')
  switch (mood) {
    case 'work':
      return [0, 1, 2]
        .map(
          i =>
            `<circle cx="${70 + i * 9}" cy="16" r="3.2" fill="${color}" opacity="0.35">` +
            a(
              `<animate attributeName="opacity" values="0.25;1;0.25" dur="1.2s" begin="${(i * 0.25).toFixed(2)}s" repeatCount="indefinite"/>`,
            ) +
            `</circle>`,
        )
        .join('')
    case 'ask':
      return (
        `<circle cx="82" cy="17" r="10" fill="${color}">` +
        a(`<animate attributeName="r" values="10;11.5;10" dur="1.6s" repeatCount="indefinite"/>`) +
        `</circle>` +
        `<text x="82" y="22.5" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="#fff">?</text>`
      )
    case 'approve':
      return (
        `<circle cx="82" cy="17" r="10" fill="${color}"/>` +
        a(
          `<circle cx="82" cy="17" r="10" fill="none" stroke="${color}" stroke-width="2"><animate attributeName="r" values="10;17" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0" dur="1.4s" repeatCount="indefinite"/></circle>`,
        ) +
        `<text x="82" y="22.5" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="#fff">!</text>`
      )
    case 'happy': {
      const star = (x: number, y: number, s: number, begin: string): string =>
        `<path d="M${x} ${y - s} L${x + s * 0.28} ${y - s * 0.28} L${x + s} ${y} L${x + s * 0.28} ${y + s * 0.28} L${x} ${y + s} L${x - s * 0.28} ${y + s * 0.28} L${x - s} ${y} L${x - s * 0.28} ${y - s * 0.28} Z" fill="#E9B44C">` +
        a(
          `<animate attributeName="opacity" values="0.3;1;0.3" dur="1.6s" begin="${begin}" repeatCount="indefinite"/>`,
        ) +
        `</path>`
      return star(82, 18, 8, '0s') + star(16, 28, 5, '0.5s') + star(90, 44, 4, '1s')
    }
    case 'worry':
      return (
        `<path d="M80 10 Q86 20 80 25 Q74 20 80 10 Z" fill="#8FB8E0">` +
        a(
          `<animateTransform attributeName="transform" type="translate" values="0 0;0 6;0 0" dur="1.8s" repeatCount="indefinite"/>`,
        ) +
        `</path>`
      )
    case 'sleep':
      return (
        `<text x="74" y="26" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="13" font-weight="700" fill="${color}">z` +
        a(
          `<animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" repeatCount="indefinite"/>`,
        ) +
        `</text>` +
        `<text x="84" y="14" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="17" font-weight="700" fill="${color}">Z` +
        a(
          `<animate attributeName="opacity" values="1;0.2;1" dur="2.4s" repeatCount="indefinite"/>`,
        ) +
        `</text>`
      )
    default:
      return ''
  }
}

export type AvatarOptions = {
  look: NoktaLook
  mood: NoktaMood
  /** Base64 PNG of the render; without it only the vector Nokta is drawn. */
  png?: string
  /** Base64 PNG of the same look with its eyes shut (the sleeping render): the blink. Poses that match only. */
  blinkPng?: string
  /** A disc [cx, cy, r] (fractions) wholly inside the render, where the vector fallback sits. */
  disc?: [number, number, number]
  /** CSS pixels, both sides. */
  size: number
  /** SMIL motion (breathing, hopping, blinking, the mood's prop); a surface that does not run it shows the still picture. */
  animated: boolean
  /** A soft halo in the mood's colour behind the character (the pane's big picture). */
  glow: boolean
}

/** The moods whose pose (arms down) the closed-eyes render matches: they may blink. */
const BLINKS: Partial<Record<NoktaMood, number>> = { neutral: 5.4, work: 4.2, ask: 6, worry: 6.6 }

/** Whether a mood's pose lets it blink with the sleeping render. */
export function canBlink(mood: NoktaMood): boolean {
  return BLINKS[mood] !== undefined
}

const EASE = '0.45 0 0.55 1'

function animateTransform(type: 'translate' | 'rotate' | 'scale', values: string, dur: number, keyTimes?: string): string {
  const n = values.split(';').length
  const times = keyTimes ?? Array.from({ length: n }, (_, i) => (i / (n - 1)).toFixed(3)).join(';')
  const splines = Array.from({ length: n - 1 }, () => EASE).join(';')
  return (
    `<animateTransform attributeName="transform" type="${type}" values="${values}" keyTimes="${times}" ` +
    `calcMode="spline" keySplines="${splines}" dur="${dur}s" repeatCount="indefinite"/>`
  )
}

/** The mood's motion around its content: breathing, bobbing, swaying, hopping, shivering. */
function wrapMotion(mood: NoktaMood, inner: string, animated: boolean): string {
  if (!animated) return `<g>${inner}</g>`
  switch (mood) {
    case 'work':
      return `<g>${animateTransform('translate', '0 0;0 -2.4;0 0', 0.9)}${inner}</g>`
    case 'ask':
      return `<g>${animateTransform('rotate', '-2.6 50 90;2.6 50 90;-2.6 50 90', 2.6)}${inner}</g>`
    case 'approve':
      return `<g>${animateTransform('translate', '0 0;0 -5;0 0;0 0', 1.4, '0;0.22;0.44;1')}${inner}</g>`
    case 'happy':
      return `<g>${animateTransform('translate', '0 0;0 -7;0 0;0 0', 2, '0;0.17;0.34;1')}${inner}</g>`
    case 'worry':
      return `<g>${animateTransform('translate', '0 0;-0.9 0;0.9 0;-0.9 0;0.9 0;0 0;0 0', 2.6, '0;0.03;0.06;0.09;0.12;0.15;1')}${inner}</g>`
    case 'sleep':
      return (
        `<g transform="translate(50 90)"><g>${animateTransform('scale', '1;1.03;1', 4)}` +
        `<g transform="translate(-50 -90)">${inner}</g></g></g>`
      )
    default:
      return `<g>${animateTransform('translate', '0 0;0 -1.6;0 0', 3.2)}${inner}</g>`
  }
}

type Parts = { defs: string; body: string }

/** The picture proper, in a 100 x 100 box: halo, ground shadow, the moving character and the mood's prop. */
function avatarParts(o: AvatarOptions, tag: string): Parts {
  const fill = BODY_FILL[o.look.color] ?? BODY_FILL['clay'] ?? '#E8A07E'
  const ink = o.look.color === 'ink' ? '#F3EEE6' : '#3A2A22'
  const [cx, cy, r] = o.disc ?? [0.5, 0.56, 0.3]
  const R = r * 100
  const blink = BLINKS[o.mood]
  const isBlinking = o.animated && o.blinkPng !== undefined && blink !== undefined
  const frame = (png: string, extra: string): string =>
    `<image x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" ${extra}` +
    `href="data:image/png;base64,${png}">`
  const image =
    o.png === undefined
      ? ''
      : frame(o.png, '') +
        (isBlinking
          ? `<animate attributeName="opacity" calcMode="discrete" values="1;0;1" keyTimes="0;0.955;0.985" dur="${blink}s" repeatCount="indefinite"/>`
          : '') +
        '</image>'
  const shut =
    isBlinking && o.blinkPng !== undefined
      ? frame(o.blinkPng, 'opacity="0" ') +
        `<animate attributeName="opacity" calcMode="discrete" values="0;1;0" keyTimes="0;0.955;0.985" dur="${blink}s" repeatCount="indefinite"/></image>`
      : ''
  // the halo takes the body's own warm colour: a mood-coloured one (green for "ready") looked like a stain
  const glow = o.glow
    ? `<radialGradient id="h${tag}" cx="50%" cy="55%" r="50%"><stop offset="0%" stop-color="${fill}" stop-opacity="0.34"/>` +
      `<stop offset="62%" stop-color="${fill}" stop-opacity="0.1"/><stop offset="100%" stop-color="${fill}" stop-opacity="0"/></radialGradient>`
    : ''
  const ground = `<radialGradient id="s${tag}"><stop offset="0%" stop-color="#000" stop-opacity="0.3"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></radialGradient>`
  const content =
    `<g transform="translate(${(cx * 100).toFixed(1)} ${(cy * 100).toFixed(1)}) scale(${R.toFixed(1)})">` +
    `<circle r="1" fill="${fill}"/>${vectorFace(o.mood, ink)}</g>` +
    image +
    shut +
    badge(o.mood, o.animated)
  return {
    defs: glow + ground,
    body:
      (o.glow ? `<circle cx="50" cy="56" r="49" fill="url(#h${tag})"/>` : '') +
      `<ellipse cx="50" cy="92" rx="${Math.max(18, R * 1.05).toFixed(1)}" ry="4.4" fill="url(#s${tag})"/>` +
      wrapMotion(o.mood, content, o.animated),
  }
}

/**
 * Nokta as an SVG for the remote surfaces. The render is the picture; under it sits a vector Nokta shaped
 * to fit inside the render's silhouette, so where a surface drops <image> there is still a face.
 * Motion is SMIL: it needs no script and no state, and where it does not run the picture is simply still.
 */
export function avatarSvg(o: AvatarOptions): string {
  const title = xml(`${o.look.name}: ${MOOD[o.mood].label}`)
  const parts = avatarParts(o, `${o.size}${o.mood}`)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="${o.size}" height="${o.size}" role="img" aria-label="${title}">` +
    `<title>${title}</title><defs>${parts.defs}</defs>${parts.body}</svg>`
  )
}

const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"
const SERIF = "Georgia,'Times New Roman',serif"
const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"
/** Colours that read on a dark surface and on a light one alike: the surface's theme is not ours to know. */
const ACCENT = '#D97757'
const GRAY = '#8C8A85'

export type HeroOptions = {
  look: NoktaLook
  mood: NoktaMood
  png?: string
  blinkPng?: string
  disc?: [number, number, number]
  /** CSS pixels the card is drawn at. */
  width: number
  /** The small caps line above the headline. */
  label: string
  headline: string
  /** The pill: what Nokta is doing, and for how long. */
  chip: string
  /** Up to two lines of detail under the pill. */
  lines: readonly string[]
}

/** A font size that lets `text` fit `avail` pixels, serif, no more than `base`. */
function fit(text: string, avail: number, base: number): number {
  const need = text.length * base * 0.52
  return need <= avail ? base : Math.max(14, Math.floor((base * avail) / need))
}

/**
 * The pane's top card on the remote surfaces: the character big, on a warm card, with its words set in type
 * the surface's own text cannot be (a serif headline, a small caps label, a pill). One picture, so it
 * holds together; the buttons stay the surface's own.
 */
export function heroSvg(o: HeroOptions): { source: string; width: number; height: number } {
  // the whole picture; else without the blink; else the vector Nokta alone
  for (const tried of [o, { ...o, blinkPng: undefined }]) {
    const drawn = heroOnce(tried)
    if (drawn.source.length <= SVG_ROOM) return drawn
  }
  return heroOnce({ ...o, png: undefined, blinkPng: undefined })
}

/** The most an Svg's source may hold is 131072 characters; a tree past it is refused whole. */
const SVG_ROOM = 120_000

function heroOnce(o: HeroOptions): { source: string; width: number; height: number } {
  const m = MOOD[o.mood]
  const W = Math.round(Math.min(640, Math.max(300, o.width)))
  const isWide = W >= 440
  const A = isWide ? 188 : Math.min(176, W - 48)
  const ax = isWide ? 14 : Math.round((W - A) / 2)
  const ay = isWide ? 14 : 12
  const x = isWide ? ax + A + 16 : W / 2
  const avail = isWide ? W - x - 20 : W - 40
  const anchor = isWide ? 'start' : 'middle'
  const top = isWide ? 54 : ay + A + 16
  const H = isWide ? ay * 2 + A : ay + A + 128
  const headline = o.headline
  const hs = fit(headline, avail, isWide ? 26 : 24)
  const chipW = Math.round(o.chip.length * 7.1 + 34)
  const chipX = isWide ? x : Math.round((W - chipW) / 2)
  const chipY = top + 48
  const lineAt = (i: number): number => chipY + 26 + 24 + i * 19
  const parts = avatarParts(
    { look: o.look, mood: o.mood, png: o.png, blinkPng: o.blinkPng, disc: o.disc, size: A, animated: true, glow: true },
    `hero${o.mood}`,
  )
  const title = xml(`${o.look.name}: ${m.label}`)
  const lines = o.lines
    .slice(0, 2)
    .map(
      (line, i) =>
        `<text x="${x}" y="${lineAt(i)}" text-anchor="${anchor}" font-family="${MONO}" font-size="11.5" fill="${GRAY}">${xml(clip(line, Math.max(8, Math.floor(avail / 6.9))))}</text>`,
    )
    .join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<defs><linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0.18"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0.05"/></linearGradient></defs>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="url(#card)" stroke="${ACCENT}" stroke-opacity="0.28"/>` +
    `<svg x="${ax}" y="${ay}" width="${A}" height="${A}" viewBox="0 0 100 100" overflow="visible"><defs>${parts.defs}</defs>${parts.body}</svg>` +
    `<text x="${x}" y="${top}" text-anchor="${anchor}" font-family="${MONO}" font-size="10.5" letter-spacing="1.4" fill="${GRAY}">${xml(o.label.toUpperCase())}</text>` +
    `<text x="${x}" y="${top + 36}" text-anchor="${anchor}" font-family="${SERIF}" font-size="${hs}" font-weight="600" fill="${ACCENT}">${xml(headline)}</text>` +
    `<rect x="${chipX}" y="${chipY}" width="${chipW}" height="26" rx="13" fill="${m.ui}" fill-opacity="0.16" stroke="${m.ui}" stroke-opacity="0.35"/>` +
    `<circle cx="${chipX + 14}" cy="${chipY + 13}" r="3.6" fill="${m.ui}"/>` +
    `<text x="${chipX + 26}" y="${chipY + 17.4}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="${m.ui}">${xml(o.chip)}</text>` +
    lines +
    `</svg>`
  return { source, width: W, height: H }
}
