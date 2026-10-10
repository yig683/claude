// The lights of the studio the renders were made in (tools/nokta-render/nk_shot.studio): where each stands as seen
// from the body, its colour, and the rectangle it is: a glossy surface shows those rectangles mirrored. The strengths
// of what they light are not here: they are fitted per look (hero-palette.ts).
// Pure code: no `$`, no browser.
type V3 = readonly [number, number, number]

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Where the lights aim: the middle of the scene. */
const TARGET: V3 = [0, 0, 0.05]

/**
 * An area light as the renders had it: where it stands, which way it shines, the two sides of its rectangle (Blender
 * aims it with its -Z axis at the target and its Y axis as upright as it can be) and half of each side. `w` is how
 * bright a unit of its surface is, against the key (power over area).
 */
function area(pos: V3, size: readonly [number, number], power: number, col: V3): { pos: V3; dir: V3; x: V3; y: V3; half: readonly [number, number]; col: V3; w: number } {
  const dir = norm(sub(TARGET, pos))
  const z: V3 = [-dir[0], -dir[1], -dir[2]]
  const k = dot([0, 0, 1], z)
  const y = norm([-k * z[0], -k * z[1], 1 - k * z[2]])
  const x = cross(y, z)
  return { pos, dir, x, y, half: [size[0] / 2, size[1] / 2], col, w: power / (size[0] * size[1]) / (2900 / (6.5 * 5)) }
}

export const LIGHTS = {
  key: { dir: norm([-4.6, -7.2, 6.95]), col: [1.0, 0.92, 0.84] },
  fill: { dir: norm([6.5, -6.0, 1.75]), col: [0.82, 0.88, 1.0] },
  rimL: { dir: norm([-4.4, 3.6, 2.75]), col: [1.0, 0.86, 0.72] },
  rimR: { dir: norm([4.4, 3.4, 3.15]), col: [0.78, 0.86, 1.0] },
  top: { dir: norm([0, -0.6, 6.75]), col: [1, 1, 1] },
  bounce: { dir: norm([0, -4, -0.95]), col: [1.0, 0.77, 0.63] },
} as const

/** The same six as rectangles in the studio (nk_shot.studio: position, size, power, colour). */
export const STUDIO = {
  key: area([-4.6, -7.2, 7.0], [6.5, 5.0], 2900, [1.0, 0.92, 0.84]),
  fill: area([6.5, -6.0, 1.8], [7.0, 6.0], 330, [0.82, 0.88, 1.0]),
  rimL: area([-4.4, 3.6, 2.8], [1.6, 5.0], 1000, [1.0, 0.86, 0.72]),
  rimR: area([4.4, 3.4, 3.2], [1.6, 5.0], 1000, [0.78, 0.86, 1.0]),
  top: area([0, -0.6, 6.8], [4.0, 4.0], 320, [1, 1, 1]),
  bounce: area([0, -4, -0.9], [6.0, 2.0], 90, [1.0, 0.77, 0.63]),
} as const
