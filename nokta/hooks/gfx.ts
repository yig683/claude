// A tiny scene graph: shapes, gradients, groups. Two backends read the same scene: SVG text (the apps) and
// a software rasterizer (the terminal's cells). Pure code: no `$`, no DOM.

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

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return IDENTITY
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** A gradient stop: offset 0..1, colour '#rrggbb', opacity 0..1. */
export type Stop = readonly [offset: number, color: string, opacity?: number]

export type Linear = { k: 'lin'; x1: number; y1: number; x2: number; y2: number; stops: readonly Stop[] }
export type Radial = { k: 'rad'; cx: number; cy: number; r: number; stops: readonly Stop[] }
/** A colour ('#rrggbb') or a gradient, in the coordinates of the node it fills (user space of its group). */
export type Paint = string | Linear | Radial

export type Shape =
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  | { k: 'path'; d: string }
  /** A picture: `href` is a data URI. */
  | { k: 'image'; x: number; y: number; w: number; h: number; href: string }

export type Stroke = { paint: string; width: number }

export type Node = {
  shape?: Shape
  fill?: Paint
  stroke?: Stroke
  /** 0..1, of this node and all beneath it. */
  opacity?: number
  /** Where this node and all beneath it are placed. */
  m?: Mat
  kids?: readonly Node[]
}

// ------------------------------------------------------------------ builders

export const lin = (x1: number, y1: number, x2: number, y2: number, stops: readonly Stop[]): Linear => ({ k: 'lin', x1, y1, x2, y2, stops })
export const rad = (cx: number, cy: number, r: number, stops: readonly Stop[]): Radial => ({ k: 'rad', cx, cy, r, stops })

export const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: Paint, extra: Partial<Node> = {}): Node => ({
  shape: { k: 'ellipse', cx, cy, rx, ry },
  fill,
  ...extra,
})

export const circle = (cx: number, cy: number, r: number, fill: Paint, extra: Partial<Node> = {}): Node => ellipse(cx, cy, r, r, fill, extra)

export const rect = (x: number, y: number, w: number, h: number, r: number, fill: Paint, extra: Partial<Node> = {}): Node => ({
  shape: { k: 'rect', x, y, w, h, r },
  fill,
  ...extra,
})

export const path = (d: string, fill: Paint | undefined, extra: Partial<Node> = {}): Node => ({ shape: { k: 'path', d }, fill, ...extra })

/** A line or curve drawn with a round-capped pen. */
export const pen = (d: string, color: string, width: number, extra: Partial<Node> = {}): Node => ({
  shape: { k: 'path', d },
  stroke: { paint: color, width },
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

// ------------------------------------------------------------------ path helpers

/** A number as short text: two decimals at most, no trailing zeros. */
export function n(x: number): string {
  const r = Math.round(x * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

export type Pt = readonly [number, number]

/** A smooth closed curve through the points (Catmull-Rom as cubic Béziers): soft, organic outlines. */
export function blob(points: readonly Pt[], isClosed = true): string {
  const count = points.length
  const at = (i: number): Pt => points[((i % count) + count) % count] as Pt
  let d = `M${n(at(0)[0])} ${n(at(0)[1])}`
  const last = isClosed ? count : count - 1
  for (let i = 0; i < last; i += 1) {
    const p0 = isClosed ? at(i - 1) : at(Math.max(0, i - 1))
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = isClosed ? at(i + 2) : at(Math.min(count - 1, i + 2))
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`
  }
  return isClosed ? `${d}Z` : d
}

/** A polygon with rounded corners (cubic, `k` how round: 0.55 is a circle's, more is softer). */
export function rounded(points: readonly Pt[], radius: number, k = 0.62): string {
  const count = points.length
  const at = (i: number): Pt => points[((i % count) + count) % count] as Pt
  const toward = (a: Pt, b: Pt, dist: number): Pt => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const t = Math.min(dist, len / 2) / len
    return [a[0] + dx * t, a[1] + dy * t]
  }
  let d = ''
  for (let i = 0; i < count; i += 1) {
    const prev = at(i - 1)
    const v = at(i)
    const next = at(i + 1)
    const a = toward(v, prev, radius)
    const b = toward(v, next, radius)
    const c1: Pt = [a[0] + (v[0] - a[0]) * k, a[1] + (v[1] - a[1]) * k]
    const c2: Pt = [b[0] + (v[0] - b[0]) * k, b[1] + (v[1] - b[1]) * k]
    d += `${i === 0 ? 'M' : 'L'}${n(a[0])} ${n(a[1])}C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(b[0])} ${n(b[1])}`
  }
  return `${d}Z`
}

const K = 0.5522847498

/** A capsule standing on (0,0), `len` long (its two centres), `r` the radius: a limb, an ear. */
export function capsule(r: number, len: number): string {
  const c = K * r
  return (
    `M${n(-r)} 0C${n(-r)} ${n(-c)} ${n(-c)} ${n(-r)} 0 ${n(-r)}C${n(c)} ${n(-r)} ${n(r)} ${n(-c)} ${n(r)} 0` +
    `L${n(r)} ${n(len)}C${n(r)} ${n(len + c)} ${n(c)} ${n(len + r)} 0 ${n(len + r)}C${n(-c)} ${n(len + r)} ${n(-r)} ${n(len + c)} ${n(-r)} ${n(len)}Z`
  )
}

/** An ellipse as a path (for shapes that must be a path), with the same Béziers a circle gets. */
export function ovalPath(cx: number, cy: number, rx: number, ry: number): string {
  const kx = K * rx
  const ky = K * ry
  return (
    `M${n(cx - rx)} ${n(cy)}C${n(cx - rx)} ${n(cy - ky)} ${n(cx - kx)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)}` +
    `C${n(cx + kx)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ky)} ${n(cx + rx)} ${n(cy)}` +
    `C${n(cx + rx)} ${n(cy + ky)} ${n(cx + kx)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)}` +
    `C${n(cx - kx)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ky)} ${n(cx - rx)} ${n(cy)}Z`
  )
}

// ------------------------------------------------------------------ SVG

export type SvgOptions = {
  viewBox: readonly [number, number, number, number]
  width: number
  height: number
  /** Prefix of gradient ids, so two drawings in one document never clash. */
  prefix?: string
  title?: string
}

export function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function stopsSvg(stops: readonly Stop[]): string {
  return stops
    .map(([o, c, a]) => `<stop offset="${n(o)}" stop-color="${c}"${a === undefined || a >= 1 ? '' : ` stop-opacity="${n(a)}"`}/>`)
    .join('')
}

/** The scene as an SVG document. Gradients are user-space, so they travel with the node that uses them. */
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
        paint.k === 'lin'
          ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(paint.x1)}" y1="${n(paint.y1)}" x2="${n(paint.x2)}" y2="${n(paint.y2)}">${stopsSvg(paint.stops)}</linearGradient>`
          : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(paint.cx)}" cy="${n(paint.cy)}" r="${n(paint.r)}">${stopsSvg(paint.stops)}</radialGradient>`,
      )
    }
    return `url(#${id})`
  }
  const shapeAttrs = (s: Shape): { tag: string; attrs: string; isPlain: boolean } => {
    switch (s.k) {
      case 'ellipse':
        return s.rx === s.ry
          ? { tag: 'circle', attrs: `cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.rx)}"`, isPlain: true }
          : { tag: 'ellipse', attrs: `cx="${n(s.cx)}" cy="${n(s.cy)}" rx="${n(s.rx)}" ry="${n(s.ry)}"`, isPlain: true }
      case 'rect':
        return {
          tag: 'rect',
          attrs: `x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}"${s.r ? ` rx="${n(s.r)}"` : ''}`,
          isPlain: true,
        }
      case 'path':
        return { tag: 'path', attrs: `d="${s.d}"`, isPlain: true }
      case 'image':
        // plain <image> elements: they are what every surface is known to draw
        return {
          tag: 'image',
          attrs: `x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" preserveAspectRatio="none" href="${s.href}"`,
          isPlain: false,
        }
    }
  }
  const emit = (node: Node): string => {
    const attrs: string[] = []
    if (node.m !== undefined) attrs.push(`transform="matrix(${node.m.map(n).join(' ')})"`)
    if (node.opacity !== undefined && node.opacity < 1) attrs.push(`opacity="${n(Math.max(0, node.opacity))}"`)
    let body = ''
    if (node.shape !== undefined) {
      const { tag, attrs: shape, isPlain } = shapeAttrs(node.shape)
      if (isPlain) {
        const fill = node.fill === undefined ? 'none' : paintRef(node.fill)
        const stroke =
          node.stroke === undefined
            ? ''
            : ` stroke="${node.stroke.paint}" stroke-width="${n(node.stroke.width)}" stroke-linecap="round" stroke-linejoin="round"`
        body += `<${tag} ${shape} fill="${fill}"${stroke}/>`
      } else {
        body += `<${tag} ${shape}/>`
      }
    }
    for (const kid of node.kids ?? []) body += emit(kid)
    if (attrs.length === 0) return node.shape !== undefined && (node.kids ?? []).length === 0 ? body : `<g>${body}</g>`
    // a lone shape carries its own transform and opacity; a group wraps its kids
    if (node.shape !== undefined && (node.kids ?? []).length === 0) return body.replace(/^<(\w+) /, `<$1 ${attrs.join(' ')} `)
    return `<g ${attrs.join(' ')}>${body}</g>`
  }
  const inner = emit(root)
  const title = o.title === undefined ? '' : `<title>${xmlEscape(o.title)}</title>`
  const [vx, vy, vw, vh] = o.viewBox
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" width="${n(o.width)}" height="${n(o.height)}"` +
    `${o.title === undefined ? '' : ' role="img"'}>${title}${defs.length === 0 ? '' : `<defs>${defs.join('')}</defs>`}${inner}</svg>`
  )
}
