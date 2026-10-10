// Nokta, live: the surface module that draws the 3D model inside the desktop app, frame after frame, with the
// engine out of the loop. Each beat of its clock the motion model (hero-motion.ts) says where every part stands, the
// GPU draws the model (hero-shader.ts, WebGL 2) into a canvas, and the picture goes back as an `Svg`: the stage, the
// shadow, the live Nokta and the small things floating around it (the pane), or the small face alone (the band, `mini`).
// A module that is not drawn is not run: when the pane closes the frames stop.
//
// It runs in the app's own frame, where the browser's canvas is. Nothing is built or drawn in the call that mounts it
// (the app gives a module a second at most): the first beat does that, and a driver that builds the program on its
// own time (KHR_parallel_shader_compile) is waited for. Anything that goes wrong (no WebGL, a context that keeps being
// lost, a program that never builds, a picture too heavy for the app) is posted to the hooks module, which then draws
// the old, still pictures instead; while it works it says so every few seconds.
// The pointer over the picture is Nokta's to follow: it looks at it, and a click is a pat.
import type { ClientModule, ClientPointerEvent, ClientSurface, RenderElement } from 'claude-code'

import type { NoktaAccessory, NoktaBody, NoktaColor } from '../types'
import { isSprites, liveFaceSvg, liveHeroSvg } from './art'
import { packFrame } from './hero-frame'
import type { Anim } from './hero-motion'
import { newAnim, stepAnim } from './hero-motion'
import { paletteP } from './hero-palette'
import type { Spec } from './hero-shader'
import { fragSource, VERT } from './hero-shader'
import { NSLOT } from './hero-slots'
import { MOOD } from './model'
import type { Sprites } from './motion'

export type HeroProps = {
  /** NoktaMood */
  mood: string
  isStill: boolean
  name: string
  body: string
  color: string
  accessory: string
  /** the colour of the glow on the stage, '#rrggbb' */
  glow: string
  /** the pack's silhouette of the resting pose and its scale: where the live picture is set (art.liveHeroSvg) */
  box: number[]
  half: number
  fit: number
  /** the size of the picture in the pane, CSS pixels */
  w: number
  h: number
  sprites: Record<string, { half: number; w: string }>
  /** the rendered picture of the mood (base64 WebP): it stands in the place until the first live picture is drawn */
  still?: string
  /** Nokta small, as the band shows it: the picture alone, `w` pixels square, drawn more slowly, and not to be pointed at */
  mini?: boolean
}

// biome-ignore lint/suspicious/noExplicitAny: the browser's objects are not typed here
type Any = any
const G: Any = typeof globalThis === 'undefined' ? {} : globalThis
const nowMs = (): number => (G.performance !== undefined && typeof G.performance.now === 'function' ? G.performance.now() : Date.now())

type Rig = {
  canvas: Any
  gl: Any
  prog: Any
  shaders: Any[]
  /** the extension that lets the driver build the program on its own time, or null */
  parallel: Any
  uRes: Any
  uSamples: Any
  uU: Any
  uP: Any
  n: number
  info: string
  isLost: boolean
  /** the program is built and its inputs are found: frames can be drawn */
  isReady: boolean
  /** the look it was made for: a program holds one body and one accessory */
  key: string
}

type State = {
  props: HeroProps
  anim: Anim
  rig: Rig | undefined
  size: number
  u: Float32Array
  last: number
  src: string
  frames: number
  fault: string
  /** what a still picture was last drawn for, so that a motionless Nokta is drawn once */
  stillKey: string
  /** which look the numbers of the light were last sent for */
  paletteKey: string
  /** how the picture is sent: a PNG, or a WebP at this quality (lighter, when a PNG would not fit) */
  format: 'png' | number
  /** when the program was handed to the driver */
  buildAt: number
  /** how light the picture is made: 0 full, 1 one sample a pixel, 2 that on a canvas a quarter smaller (a slow card) */
  level: 0 | 1 | 2
  /** the smoothed cost of a frame, ms, and the interval the clock runs at */
  cost: number
  every: number
  slow: number
  fast: number
  stop: (() => void) | undefined
  postedAt: number
  /** contexts lost lately: one now and then is a driver having a bad moment, many is a machine that cannot do this */
  losses: number
  lostAt: number
  /** where the pointer is over the picture (-1 .. 1 from the middle), and when it last moved; none when it is away */
  pointer: { x: number; y: number; at: number } | undefined
}

const MOODS = ['neutral', 'work', 'ask', 'approve', 'happy', 'worry', 'sleep', 'love'] as const
type Mood = (typeof MOODS)[number]
const moodOf = (s: string): Mood => (MOODS.includes(s as Mood) ? (s as Mood) : 'neutral')

const BODIES: readonly NoktaBody[] = ['nokta', 'bulut', 'tavsan', 'ucgen']
const COLORS: readonly NoktaColor[] = ['clay', 'sky', 'sage', 'kraft', 'ink', 'peach']
const ACCESSORIES: readonly NoktaAccessory[] = ['none', 'glasses', 'beret', 'bowtie']

function lookOf(p: HeroProps): { body: NoktaBody; color: NoktaColor; accessory: NoktaAccessory } {
  return {
    body: BODIES.includes(p.body as NoktaBody) ? (p.body as NoktaBody) : 'nokta',
    color: COLORS.includes(p.color as NoktaColor) ? (p.color as NoktaColor) : 'clay',
    accessory: ACCESSORIES.includes(p.accessory as NoktaAccessory) ? (p.accessory as NoktaAccessory) : 'none',
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const within = (v: unknown, lo: number, hi: number, fallback: number): number => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const DEFAULT_BOX: readonly number[] = [0.3, 0.3, 0.7, 0.8]

/** What the module draws with, made fit to draw with whatever it was handed (a number that is not one, a colour that is not a colour). */
function sane(p: HeroProps): { box: readonly number[]; half: number; fit: number; w: number; h: number; glow: string; name: string; sprites: Sprites } {
  return {
    box: Array.isArray(p.box) && p.box.length === 4 && p.box.every(isNum) ? p.box : DEFAULT_BOX,
    half: within(p.half, 0.5, 4, 1.78),
    fit: within(p.fit, 0.2, 2, 1),
    w: within(p.w, 16, 4000, 500),
    h: within(p.h, 16, 4000, 222),
    glow: typeof p.glow === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.glow) ? p.glow : '#EC7F5E',
    name: typeof p.name === 'string' ? p.name.slice(0, 40) : 'Nokta',
    sprites: isSprites(p.sprites) ? p.sprites : {},
  }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** The place of the picture before the first live one: the rendered picture of the mood on its stage, or a blank of the same size. */
function held(p: HeroProps): string {
  const s = sane(p)
  const mood = moodOf(p.mood)
  const still = p.still
  if (typeof still === 'string' && still.length > 0 && still.length < 40_000 && BASE64.test(still)) {
    const around = { title: `${s.name}: ${MOOD[mood].label}`, glow: s.glow, mood, t: 0.4, dy: 0, box: s.box, half: s.half, fit: s.fit, sprites: s.sprites, href: `data:image/webp;base64,${still}` }
    const source = p.mini === true ? liveFaceSvg({ ...around, size: s.w }) : liveHeroSvg({ ...around, width: s.w, height: s.h })
    if (source.length <= SVG_MAX) return source
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.w} ${s.h}" width="${s.w}" height="${s.h}"/>`
}

const FRAME_MS = 40
const SLOW_MS = 66
/** The small Nokta of the band needs fewer frames. */
const MINI_MS = 66
const MINI_SLOW_MS = 100
const frameMs = (p: HeroProps): number => (p.mini === true ? MINI_MS : FRAME_MS)
const slowMs = (p: HeroProps): number => (p.mini === true ? MINI_SLOW_MS : SLOW_MS)
/** how long the pointer is followed after it last moved, seconds */
const FOLLOW_S = 2.5

function makeRig(n: number, spec: Spec): Rig {
  const doc = G.document
  if (doc === undefined) throw new Error('no document: the frame has no canvas')
  const canvas = doc.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  if (!gl) throw new Error('no WebGL 2 context')
  // the program is handed to the driver at once, and looked at only when it says it is built (where it can say so):
  // the first build on a machine can take longer than the app lets a module take
  const compile = (type: number, source: string): Any => {
    const s = gl.createShader(type)
    gl.shaderSource(s, source)
    gl.compileShader(s)
    return s
  }
  const prog = gl.createProgram()
  const shaders = [compile(gl.VERTEX_SHADER, VERT), compile(gl.FRAGMENT_SHADER, fragSource(spec))]
  for (const s of shaders) gl.attachShader(prog, s)
  gl.linkProgram(prog)
  const rig: Rig = {
    canvas,
    gl,
    prog,
    shaders,
    parallel: gl.getExtension('KHR_parallel_shader_compile') ?? null,
    uRes: null,
    uSamples: null,
    uU: null,
    uP: null,
    n,
    info: '',
    isLost: false,
    isReady: false,
    key: `${spec.body}-${spec.accessory}`,
  }
  // a context the browser takes away (a driver reset, too many contexts) is made again on the next frame
  canvas.addEventListener('webglcontextlost', (event: Any) => {
    event.preventDefault()
    rig.isLost = true
  })
  if (rig.parallel === null) finishRig(rig)
  return rig
}

/** The program is built: say how it went, and take hold of what it is fed with. */
function finishRig(rig: Rig): void {
  const gl = rig.gl
  for (const s of rig.shaders) {
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${String(gl.getShaderInfoLog(s)).slice(0, 300)}`)
  }
  if (!gl.getProgramParameter(rig.prog, gl.LINK_STATUS)) throw new Error(`link: ${String(gl.getProgramInfoLog(rig.prog)).slice(0, 300)}`)
  gl.useProgram(rig.prog)
  gl.viewport(0, 0, rig.n, rig.n)
  gl.clearColor(0, 0, 0, 0)
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  rig.info = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.VERSION))
  rig.uRes = gl.getUniformLocation(rig.prog, 'uRes')
  rig.uSamples = gl.getUniformLocation(rig.prog, 'uSamples')
  rig.uU = gl.getUniformLocation(rig.prog, 'uU')
  rig.uP = gl.getUniformLocation(rig.prog, 'uP')
  rig.isReady = true
}

/** Whether frames can be drawn yet: false while the driver is still building the program. */
function isBuilt(rig: Rig): boolean {
  if (rig.isReady) return true
  if (rig.parallel !== null && !rig.gl.getProgramParameter(rig.prog, rig.parallel.COMPLETION_STATUS_KHR)) return false
  finishRig(rig)
  return true
}

function dropRig(rig: Rig | undefined): void {
  try {
    rig?.gl.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    // nothing to free
  }
}

/** How many pixels the picture needs: what the pane shows it at, on this screen, in steps of eight. */
function sizeFor(p: HeroProps): number {
  const dpr = typeof G.devicePixelRatio === 'number' && G.devicePixelRatio > 0 ? G.devicePixelRatio : 1
  const s = sane(p)
  // (the small one shows 196 units of the stage in `w` pixels, the big one 222 units in `h`)
  const css = p.mini === true ? (2 * s.half * 64 * s.fit * s.w) / 196 : 2 * s.half * 64 * s.fit * (s.h / 222)
  return p.mini === true ? Math.max(48, Math.min(160, Math.round((css * dpr) / 8) * 8)) : Math.max(96, Math.min(384, Math.round((css * dpr) / 8) * 8))
}

/** The most characters the picture of a frame may take: the app takes 100 000 for all of what a module draws. */
const SVG_MAX = 96_000
/** How long a driver may take to build the program before it is given up on, ms. */
const BUILD_MAX_MS = 30_000
/** What a picture too heavy for a PNG is sent as: WebP at these qualities, the first that fits. */
const WEBP_STEPS = [0.9, 0.8, 0.66, 0.5] as const

/** Draws a frame; false while the program is still being built (nothing is drawn then). */
function drawFrame(st: State, dt: number): boolean {
  const p = st.props
  const look = lookOf(p)
  // (a slow card draws on a smaller canvas, which the app draws larger)
  const size = st.level === 2 ? Math.max(48, Math.round((sizeFor(p) * 0.75) / 8) * 8) : sizeFor(p)
  if (st.rig !== undefined && (st.rig.isLost || st.rig.gl.isContextLost())) {
    dropRig(st.rig)
    st.rig = undefined
    const now = nowMs()
    st.losses = now - st.lostAt < 30000 ? st.losses + 1 : 1
    st.lostAt = now
    if (st.losses > 4) throw new Error('the WebGL context keeps being lost')
  }
  // (a program holds one body and one accessory: another look is another program, and the picture of the old one is not shown)
  if (st.rig !== undefined && st.rig.key !== `${look.body}-${look.accessory}`) {
    dropRig(st.rig)
    st.rig = undefined
    st.src = ''
    st.stillKey = ''
  }
  if (st.rig === undefined) {
    st.rig = makeRig(size, look)
    st.size = size
    st.paletteKey = ''
    st.format = size <= 320 ? 'png' : WEBP_STEPS[0]
    st.buildAt = nowMs()
  } else if (st.rig.n !== size) {
    // the pane was resized: the same context draws at the new size, nothing is built again
    st.rig.canvas.width = size
    st.rig.canvas.height = size
    st.rig.n = size
    st.size = size
    st.format = size <= 320 ? 'png' : WEBP_STEPS[0]
  }
  const rig = st.rig
  if (!isBuilt(rig)) {
    if (nowMs() - st.buildAt > BUILD_MAX_MS) throw new Error('the program took more than 30 s to build')
    return false
  }
  const gl = rig.gl
  gl.viewport(0, 0, size, size)
  const paletteKey = look.color
  if (st.paletteKey !== paletteKey) {
    gl.uniform1fv(rig.uP, paletteP(look.color))
    st.paletteKey = paletteKey
  }
  const mood = moodOf(p.mood)
  st.anim.look = look
  // the pointer: Nokta looks at it for a moment after it moves, as far as its eyes go
  const follow = st.pointer !== undefined && nowMs() - st.pointer.at < FOLLOW_S * 1000 ? st.pointer : undefined
  const { frame, dy } = stepAnim(st.anim, dt, mood, p.isStill, follow === undefined ? undefined : [follow.x * 1.8, -follow.y * 1.1])
  packFrame(frame, st.u)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.uniform2f(rig.uRes, size, size)
  gl.uniform1i(rig.uSamples, st.level === 0 ? 4 : 1)
  gl.uniform4fv(rig.uU, st.u)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const s = sane(p)
  const around = {
    title: `${s.name}: ${MOOD[mood].label}`,
    glow: s.glow,
    mood,
    t: p.isStill ? 0.4 : st.anim.t,
    dy,
    box: s.box,
    half: s.half,
    fit: s.fit,
    width: s.w,
    height: s.h,
    sprites: s.sprites,
  }
  const encode = (format: 'png' | number): string => (format === 'png' ? rig.canvas.toDataURL('image/png') : rig.canvas.toDataURL('image/webp', format))
  const compose = (href: string): string => (p.mini === true ? liveFaceSvg({ ...around, href, size: s.w }) : liveHeroSvg({ ...around, href }))
  let src = compose(encode(st.format))
  // a picture that does not fit is sent lighter, and stays lighter: a PNG that is near the limit would only be near it again
  for (const quality of WEBP_STEPS) {
    if (src.length <= SVG_MAX) break
    if (st.format !== 'png' && st.format <= quality) continue
    st.format = quality
    src = compose(encode(quality))
  }
  if (src.length > SVG_MAX) throw new Error(`the picture is too heavy for the app (${src.length} characters)`)
  st.src = src
  st.frames += 1
  return true
}

function tick(surface: ClientSurface<State>): void {
  const st = surface.state
  if (st === undefined || st.fault !== '') return
  const now = nowMs()
  const dt = st.last === 0 ? 0 : Math.min(0.1, (now - st.last) / 1000)
  st.last = now
  // a region that is not on screen (another tab of the pane is in front) is not drawn
  if (st.frames > 2 && surface.columns === 0) return
  const key = `${st.props.mood}|${st.props.w}|${st.props.h}|${st.props.name}|${st.props.body}|${st.props.color}|${st.props.accessory}`
  if (st.props.isStill && st.stillKey === key && st.src !== '') return
  try {
    const t0 = nowMs()
    if (drawFrame(st, dt)) {
      const cost = nowMs() - t0
      st.cost = st.cost === 0 ? cost : st.cost * 0.9 + cost * 0.1
      st.stillKey = st.props.isStill ? key : ''
      // a slow machine gets a lighter picture first (one sample a pixel, then a smaller canvas) and then fewer frames,
      // rather than a slow app; a fast moment gives them back, the frames first
      if (st.cost > 24) {
        st.slow += 1
        st.fast = 0
      } else if (st.cost < 11) {
        st.fast += 1
        st.slow = 0
      }
      if (st.slow > 12 && st.level < 2) {
        st.level += 1
        st.slow = 0
        st.cost = 0
      } else if (st.every === frameMs(st.props) && st.slow > 40) retime(surface, st, slowMs(st.props))
      else if (st.every === slowMs(st.props) && st.fast > 120) retime(surface, st, frameMs(st.props))
      else if (st.level > 0 && st.cost < 5 && st.fast > 240) {
        st.level -= 1
        st.fast = 0
        st.cost = 0
      }
    }
  } catch (e) {
    st.fault = String((e as Error).message ?? e).slice(0, 300)
    surface.post({ hero: 'fault', why: st.fault })
  }
  if (now - st.postedAt > 4000 && st.fault === '') {
    st.postedAt = now
    surface.post({ hero: 'ok', gl: st.rig?.info ?? '', size: st.size, ms: Math.round(st.cost * 10) / 10, every: st.every, frames: st.frames, isBuilding: st.frames === 0 })
  }
  surface.setState({ ...st })
}

function retime(surface: ClientSurface<State>, st: State, ms: number): void {
  st.stop?.()
  st.every = ms
  st.slow = 0
  st.fast = 0
  st.stop = surface.every(ms, () => tick(surface))
}

function listen(surface: ClientSurface<State>): void {
  surface.onPointer((e: ClientPointerEvent) => {
    // (the state is read afresh: each frame hands the module a new copy of it, and a note on an old one is lost)
    const st = surface.state
    if (st === undefined) return
    if (e.type === 'leave') {
      st.pointer = undefined
      return
    }
    const cols = Math.max(1, surface.columns)
    const rows = Math.max(1, surface.rows)
    const x = ((e.fine?.x ?? e.x + 0.5) / cols) * 2 - 1
    const y = ((e.fine?.y ?? e.y + 0.5) / rows) * 2 - 1
    st.pointer = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), at: nowMs() }
    // a press is a pat
    if (e.type === 'down') surface.post({ hero: 'pet' })
  })
}

const Hero: ClientModule<HeroProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  let st = surface.state
  if (st === undefined) {
    st = {
      props,
      anim: newAnim(lookOf(props), moodOf(props.mood)),
      rig: undefined,
      size: 0,
      u: new Float32Array(NSLOT * 4),
      last: 0,
      src: '',
      frames: 0,
      fault: '',
      stillKey: '',
      paletteKey: '',
      format: 'png',
      buildAt: 0,
      level: 0,
      cost: 0,
      every: frameMs(props),
      slow: 0,
      fast: 0,
      stop: undefined,
      postedAt: -Infinity,
      losses: 0,
      lostAt: 0,
      pointer: undefined,
    }
    surface.setState(st)
    // nothing is built or drawn in this call (the app gives a module a second at most): the first beat of the clock,
    // a moment away, does it, and until then the place holds the rendered picture of the mood
    st.stop = surface.every(frameMs(props), () => tick(surface))
    // (the small one is not to be pointed at: the band's picture is not a button)
    if (props.mini !== true) listen(surface)
    // where there is a canvas to draw on it says at once that it is there, before anything is built: a driver that
    // builds the program on this thread would keep it from saying so for as long as that takes
    if (G.document !== undefined) surface.post({ hero: 'ok', gl: '', size: 0, ms: 0, every: st.every, frames: 0, isBuilding: true })
  }
  // the pane draws again whenever its props change: what the mood is now, how large the picture is, how Nokta looks
  if (props.body !== st.props.body) st.anim = newAnim(lookOf(props), moodOf(props.mood))
  st.props = props
  const s = sane(props)
  if (st.fault !== '') return Box({ children: [Text({ dimColor: true, children: `${s.name}: çizilemedi` })] })
  // until the first picture is drawn the place is held by the rendered one (or a blank of the same size): nothing moves when the live one comes
  const source = st.src !== '' ? st.src : held(props)
  const svg: RenderElement = { type: 'Svg', props: { source, alt: `${s.name}: ${MOOD[moodOf(props.mood)].label}`, width: s.w, height: s.h } }
  return svg
}

export default Hero
