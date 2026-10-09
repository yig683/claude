// A tiny scene tree for what is drawn around the pictures: soft spots, pictures, groups, each moved by a matrix,
// written out as SVG text. Pure code: no `$`, no DOM.

/** An affine matrix as SVG's matrix(a b c d e f): x' = a x + c y + e, y' = b x + d y + f. */
export type Mat = readonly [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** `m` after `n`: the point goes through `n` first. */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

/** Outermost first: chain(a, b, c) moves a point through c, then b, then a. */
export function chain(...ms: Mat[]): Mat {
  return ms.reduce((acc, m) => mul(acc, m), IDENTITY)
}

export function move(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y]
}

/** Scales about (cx, cy). */
export function grow(sx: number, sy: number = sx, cx = 0, cy = 0): Mat {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy]
}

/** Turns by `deg` degrees about (cx, cy). */
export function turn(deg: number, cx = 0, cy = 0): Mat {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
}

/** A gradient stop: offset 0..1, colour '#rrggbb', opacity 0..1. */
export type Stop = readonly [offset: number, color: string, opacity?: number]

/** A radial gradient, in the coordinates of the node it fills. */
export type Radial = { cx: number; cy: number; r: number; stops: readonly Stop[] }

/** A colour ('#rrggbb') or a radial gradient. */
export type Paint = string | Radial

export type Shape =
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  /** A picture: `href` is a data URI. */
  | { k: 'image'; x: number; y: number; w: number; h: number; href: string }

export type Node = {
  shape?: Shape
  fill?: Paint
  /** 0..1, of this node and all beneath it. */
  opacity?: number
  /** Where this node and all beneath it are placed. */
  m?: Mat
  kids?: readonly Node[]
}

// ------------------------------------------------------------------ builders

export const rad = (cx: number, cy: number, r: number, stops: readonly Stop[]): Radial => ({ cx, cy, r, stops })

export const circle = (cx: number, cy: number, r: number, fill: Paint, extra: Partial<Node> = {}): Node => ({
  shape: { k: 'ellipse', cx, cy, rx: r, ry: r },
  fill,
  ...extra,
})

export const picture = (x: number, y: number, w: number, h: number, href: string, extra: Partial<Node> = {}): Node => ({
  shape: { k: 'image', x, y, w, h, href },
  ...extra,
})

export const group = (kids: readonly (Node | undefined | false)[], extra: Partial<Node> = {}): Node => ({
  kids: kids.filter((k): k is Node => k !== undefined && k !== false),
  ...extra,
})

// ------------------------------------------------------------------ SVG

export type SvgOptions = {
  viewBox: readonly [number, number, number, number]
  width: number
  height: number
  /** Prefix of gradient ids, so two drawings in one document never clash. */
  prefix?: string
  title?: string
}

/** A number as short text: two decimals at most, no trailing zeros. */
export function n(x: number): string {
  const r = Math.round(x * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

export function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function stopsSvg(stops: readonly Stop[]): string {
  return stops
    .map(([o, c, a]) => `<stop offset="${n(o)}" stop-color="${c}"${a === undefined || a >= 1 ? '' : ` stop-opacity="${n(a)}"`}/>`)
    .join('')
}

/**
 * The scene as an SVG document. Only what every surface is known to draw: groups, circles, ellipses, plain
 * <image> elements, radial gradients (user-space, so they travel with the node that uses them), `transform`
 * and `opacity`. No <use>, no <animate>, no script: a surface that scrubs more than that still shows Nokta.
 */
export function toSvg(root: Node, o: SvgOptions): string {
  const defs: string[] = []
  const ids = new Map<string, string>()
  const prefix = o.prefix ?? 'n'
  const paintRef = (paint: Paint): string => {
    if (typeof paint === 'string') return paint
    const key = JSON.stringify(paint)
    let id = ids.get(key)
    if (id === undefined) {
      id = `${prefix}${ids.size}`
      ids.set(key, id)
      defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(paint.cx)}" cy="${n(paint.cy)}" r="${n(paint.r)}">${stopsSvg(paint.stops)}</radialGradient>`,
      )
    }
    return `url(#${id})`
  }
  const element = (node: Node, attrs: string[]): string => {
    const s = node.shape
    if (s === undefined) return ''
    const own = attrs.length === 0 ? '' : ` ${attrs.join(' ')}`
    if (s.k === 'image') {
      return `<image${own} x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" preserveAspectRatio="none" href="${s.href}"/>`
    }
    const fill = node.fill === undefined ? 'none' : paintRef(node.fill)
    return s.rx === s.ry
      ? `<circle${own} cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.rx)}" fill="${fill}"/>`
      : `<ellipse${own} cx="${n(s.cx)}" cy="${n(s.cy)}" rx="${n(s.rx)}" ry="${n(s.ry)}" fill="${fill}"/>`
  }
  const emit = (node: Node): string => {
    const attrs: string[] = []
    if (node.m !== undefined) attrs.push(`transform="matrix(${node.m.map(n).join(' ')})"`)
    if (node.opacity !== undefined && node.opacity < 1) attrs.push(`opacity="${n(Math.max(0, node.opacity))}"`)
    const kids = (node.kids ?? []).map(emit).join('')
    // a lone shape carries its own transform and opacity; a group wraps what it holds
    if (node.shape !== undefined && kids === '') return element(node, attrs)
    return `<g${attrs.length === 0 ? '' : ` ${attrs.join(' ')}`}>${element(node, [])}${kids}</g>`
  }
  const inner = emit(root)
  const title = o.title === undefined ? '' : `<title>${xmlEscape(o.title)}</title>`
  const [vx, vy, vw, vh] = o.viewBox
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" width="${n(o.width)}" height="${n(o.height)}"` +
    `${o.title === undefined ? '' : ' role="img"'}>${title}${defs.length === 0 ? '' : `<defs>${defs.join('')}</defs>`}${inner}</svg>`
  )
}
