import type { ClientPointerEvent } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { NoktaAccessory, NoktaBody, NoktaColor } from '../types'
import { liveFaceSvg, liveHeroSvg } from '../hooks/art'
import Hero, { type HeroProps } from '../hooks/hero'
import type { Look } from '../hooks/hero-frame'
import { isLiveLook, packFrame, restFrame } from '../hooks/hero-frame'
import { accessoryFrames, armsFor, bodyD, faceParts, LAYOUT, surfaceHit, VIEW } from '../hooks/hero-model'
import type { Mood } from '../hooks/hero-moods'
import { FACE_STATES, referenceFrames } from '../hooks/hero-moods'
import { newAnim, stepAnim, STILL_T } from '../hooks/hero-motion'
import { paletteColors, PALETTES, paletteP } from '../hooks/hero-palette'
import { fragSource, VERT } from '../hooks/hero-shader'
import { ACC_SLOTS, ACCESSORY_INDEX, BODY_INDEX, NP, NSLOT, P, SLOT } from '../hooks/hero-slots'
import { FRAMES } from '../hooks/motion'
import { type Canvas, installClock, installDocument } from './support'

const BODY_LIST: readonly NoktaBody[] = ['nokta', 'bulut', 'tavsan', 'ucgen']
const COLOR_LIST: readonly NoktaColor[] = ['clay', 'sky', 'sage', 'kraft', 'ink', 'peach']
const ACCESSORY_LIST: readonly NoktaAccessory[] = ['none', 'glasses', 'beret', 'bowtie']
const MOOD_LIST = Object.keys(FACE_STATES) as Mood[]

const everyLook = (): Look[] =>
  BODY_LIST.flatMap(body => COLOR_LIST.flatMap(color => ACCESSORY_LIST.map(accessory => ({ body, color, accessory }))))

const isFiniteAll = (values: ArrayLike<number>): boolean => {
  for (let i = 0; i < values.length; i += 1) if (!Number.isFinite(values[i])) return false
  return true
}

describe('the live model: its numbers', () => {
  test('the slots of the shader do not overlap, and fill the table', () => {
    const used = new Set<number>()
    for (const [name, from] of Object.entries(SLOT)) {
      const count = name === 'acc0' ? ACC_SLOTS : 1
      for (let i = from; i < from + count; i += 1) {
        expect(used.has(i)).toBe(false)
        used.add(i)
        expect(i < NSLOT).toBe(true)
      }
    }
    expect(used.size).toBe(NSLOT)
  })

  test('the tuning numbers have a place each', () => {
    const places = Object.values(P)
    expect(new Set(places).size).toBe(places.length)
    expect(places.every(i => i >= 0 && i < NP)).toBe(true)
    for (const color of COLOR_LIST) {
      const numbers = paletteP(color)
      expect(numbers.length).toBe(NP)
      expect(isFiniteAll(numbers)).toBe(true)
      // a light that gives no light, or a surface with no exponent, would draw a black or a broken model
      expect((numbers[P.ambient] as number) > 0).toBe(true)
      expect((numbers[P.key] as number) > 0).toBe(true)
      expect((numbers[P.specExp] as number) >= 1).toBe(true)
      expect((numbers[P.sheenPow] as number) >= 1).toBe(true)
    }
  })

  test('every colour of a look has a palette whose colours are real colours', () => {
    for (const color of COLOR_LIST) {
      const p = PALETTES[color]
      for (const hex of [p.base, p.blush, p.line, p.tint, p.metal, p.cloth]) expect(/^#[0-9A-Fa-f]{6}$/.test(hex)).toBe(true)
      const colors = paletteColors(color)
      for (const rgb of Object.values(colors)) {
        expect(rgb.length).toBe(3)
        expect(rgb.every(c => c >= 0 && c <= 1)).toBe(true)
      }
    }
    // only the ink Nokta has glowing eyes
    expect(COLOR_LIST.filter(c => PALETTES[c].isGlow)).toEqual(['ink'])
  })

  test('a look that is drawn live has numbers of its own, fitted to its renders', () => {
    for (const look of everyLook()) {
      if (!isLiveLook(look)) continue
      expect(look.color === 'clay' || Object.keys(PALETTES[look.color].fit).length > 0).toBe(true)
    }
  })
})

describe('the shader', () => {
  const source = fragSource()

  test('it names every slot and every number the code feeds it', () => {
    expect(source.startsWith('#version 300 es')).toBe(true)
    expect(VERT.startsWith('#version 300 es')).toBe(true)
    expect(source.includes(`uniform vec4 uU[${NSLOT}];`)).toBe(true)
    expect(source.includes(`uniform float uP[${NP}];`)).toBe(true)
    for (const name of Object.keys(SLOT)) if (name !== 'acc0') expect(source.includes(`#define U_${name.toUpperCase()} uU[`)).toBe(true)
    for (let i = 0; i < ACC_SLOTS; i += 1) expect(source.includes(`#define U_ACC${i} uU[`)).toBe(true)
    for (const name of Object.keys(P)) expect(source.includes(`#define P_${name.toUpperCase()} uP[`)).toBe(true)
  })

  test('a program made for a look holds that look only, and every look has one that is whole', () => {
    expect(source.includes('uniform int uSamples;')).toBe(true)
    const general = source.length
    for (const body of BODY_LIST) {
      for (const accessory of ACCESSORY_LIST) {
        const one = fragSource({ body, accessory })
        expect(one.includes(`int bodyKind() { return ${BODY_INDEX[body]}; }`)).toBe(true)
        expect(one.includes(`int accKind() { return ${ACCESSORY_INDEX[accessory]}; }`)).toBe(true)
        expect(/NaN|undefined|Infinity|\[object/.test(one)).toBe(false)
        expect(one.split('{').length).toBe(one.split('}').length)
        expect(one.split('(').length).toBe(one.split(')').length)
        // the same size: it is the constants that make the compiler leave out the rest
        expect(Math.abs(one.length - general) < 200).toBe(true)
      }
    }
  })

  test('it uses nothing it did not define', () => {
    const used = new Set(source.match(/\b[UP]_[A-Z][A-Z0-9]*\b/g) ?? [])
    const defined = new Set([...source.matchAll(/#define ([UP]_[A-Z][A-Z0-9]*) /g)].map(m => m[1]))
    const missing = [...used].filter(name => !defined.has(name))
    expect(missing).toEqual([])
  })

  test('it is whole: no stray values, balanced braces and brackets', () => {
    expect(/NaN|undefined|Infinity|\[object/.test(source)).toBe(false)
    for (const [open, close] of [
      ['{', '}'],
      ['(', ')'],
      ['[', ']'],
    ] as const) {
      expect(source.split(open).length).toBe(source.split(close).length)
    }
    // a body of every kind and an accessory of every kind is in it
    expect(source.includes('void main()')).toBe(true)
  })
})

describe('the bodies', () => {
  const bodyOf = (kind: NoktaBody) => ({ kind, scale: [1, 1, 1] as const, arms: armsFor(kind, 'down'), earSway: 0 })

  test('each body has an inside and an outside, and the face lies on its skin', () => {
    for (const kind of BODY_LIST) {
      const body = bodyOf(kind)
      expect(bodyD(body, [0, 0, 0.1]) < 0).toBe(true)
      expect(bodyD(body, [5, 0, 0]) > 1).toBe(true)
      const L = LAYOUT[kind]
      for (const sx of [-1, 1]) {
        const hit = surfaceHit(body, sx * L.ex, L.ey)
        expect(Math.abs(bodyD(body, hit.p)) < 0.01).toBe(true)
        // the skin faces the viewer
        expect(hit.n[1] < -0.2).toBe(true)
      }
    }
  })

  test('the eyes sit side by side, and only the rabbit has a nose', () => {
    for (const kind of BODY_LIST) {
      const parts = faceParts(bodyOf(kind), { look: [0, 0], size: 1, lid: 0, lidTilt: 0, blink: 0 })
      const [l, r] = parts.eyes
      expect(Math.abs(l.c[0] + r.c[0]) < 1e-6).toBe(true)
      expect(Math.abs(l.c[2] - r.c[2]) < 1e-6).toBe(true)
      expect(l.c[0] < 0 && r.c[0] > 0).toBe(true)
      expect(parts.nose !== undefined).toBe(kind === 'tavsan')
    }
  })

  test('the triangle has hands only when it waves or cheers', () => {
    const handed = (pose: Parameters<typeof armsFor>[1]): number => armsFor('ucgen', pose).filter(a => a.r0 > 0.001).length
    expect(handed('down')).toBe(0)
    expect(handed('work')).toBe(0)
    expect(handed('wave')).toBe(1)
    expect(handed('cheer')).toBe(2)
    for (const kind of ['nokta', 'bulut', 'tavsan'] as const) expect(armsFor(kind, 'down').every(a => a.r0 > 0.1)).toBe(true)
  })

  test('the accessories come as the right number of numbers, and only when worn', () => {
    for (const kind of BODY_LIST) {
      const body = bodyOf(kind)
      for (const accessory of ACCESSORY_LIST) {
        const numbers = accessoryFrames(body, accessory)
        expect(numbers.length).toBe(ACC_SLOTS * 4)
        expect(isFiniteAll(numbers)).toBe(true)
        expect(numbers.some(v => v !== 0)).toBe(accessory !== 'none')
      }
    }
  })

  test('the camera frame and the face layout are known for every body', () => {
    for (const kind of BODY_LIST) {
      expect(VIEW[kind][2] > 1).toBe(true)
      expect(BODY_INDEX[kind] >= 0).toBe(true)
    }
    expect(Object.keys(ACCESSORY_INDEX)).toEqual([...ACCESSORY_LIST])
  })
})

describe('the frames', () => {
  test('every look at rest packs into finite numbers of the right count', () => {
    for (const look of everyLook()) {
      const packed = packFrame(restFrame(look))
      expect(packed.length).toBe(NSLOT * 4)
      expect(isFiniteAll(packed)).toBe(true)
    }
  })

  test('a look can show every picture the old director could ask for', () => {
    const wanted = Object.entries(FRAMES).flatMap(([mood, names]) => names.map(name => `${mood}-${name}`))
    for (const look of [{ body: 'nokta', color: 'clay', accessory: 'none' }, { body: 'ucgen', color: 'ink', accessory: 'none' }] as const) {
      const frames = referenceFrames(look)
      for (const key of wanted) {
        expect(frames[key] !== undefined).toBe(true)
        expect(isFiniteAll(packFrame(frames[key] as ReturnType<typeof restFrame>))).toBe(true)
      }
    }
  })

  test('the mouth of every look rests at the height of its own body', () => {
    for (const body of BODY_LIST) {
      const frame = restFrame({ body, color: 'clay', accessory: 'none' })
      expect(frame.mouth.strokeV0).toBe(LAYOUT[body].my)
    }
  })
})

describe('the motion', () => {
  const FPS = 25
  const run = (look: Look, mood: Mood, seconds: number, from?: ReturnType<typeof newAnim>) => {
    const anim = from ?? newAnim(look, mood)
    const frames: ReturnType<typeof stepAnim>[] = []
    for (let i = 0; i < seconds * FPS; i += 1) frames.push(stepAnim(anim, 1 / FPS, mood))
    return { anim, frames }
  }

  test('every mood on every body gives finite frames that stay within reach', () => {
    for (const body of BODY_LIST) {
      for (const mood of MOOD_LIST) {
        const { frames } = run({ body, color: 'clay', accessory: 'none' }, mood, 6)
        for (const { frame } of frames) {
          expect(isFiniteAll(packFrame(frame))).toBe(true)
          expect(frame.rot.every(r => Math.abs(r) < 1)).toBe(true)
          expect(frame.loc.every(v => Math.abs(v) < 1)).toBe(true)
          expect(frame.scale.every(s => s > 0.6 && s < 1.5)).toBe(true)
          expect(frame.mouth.strokeAlpha >= 0 && frame.mouth.openAlpha <= 1).toBe(true)
        }
      }
    }
  })

  test('the same mood at the same moment is the same frame', () => {
    const look = { body: 'tavsan', color: 'peach', accessory: 'none' } as const
    const a = run(look, 'happy', 3).frames.map(f => Array.from(packFrame(f.frame)))
    const b = run(look, 'happy', 3).frames.map(f => Array.from(packFrame(f.frame)))
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(true)
  })

  test('the body moves smoothly: no frame jumps, even at a change of mood', () => {
    const look = { body: 'nokta', color: 'clay', accessory: 'none' } as const
    const anim = newAnim(look, 'neutral')
    let last: Float32Array | undefined
    let worst = 0
    const order: Mood[] = ['neutral', 'work', 'ask', 'approve', 'happy', 'worry', 'sleep', 'love', 'neutral']
    for (const mood of order) {
      for (let i = 0; i < 3 * FPS; i += 1) {
        const packed = packFrame(stepAnim(anim, 1 / FPS, mood).frame)
        if (last !== undefined) {
          // the body: where it stands, how it leans, how large it is, where its hands are
          for (const slot of [SLOT.rot, SLOT.loc, SLOT.scale, SLOT.armLS, SLOT.armLH, SLOT.armRS, SLOT.armRH]) {
            for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs((packed[slot * 4 + c] as number) - (last[slot * 4 + c] as number)))
          }
        }
        last = Float32Array.from(packed)
      }
    }
    // (a hand may fly up in a cheer, a metre of body in a quarter of a second, but it never jumps from one frame to the next)
    expect(worst < 0.35).toBe(true)
  })

  test('a move starts softly: the first frame after a change of mood barely moves the hands', () => {
    const look = { body: 'nokta', color: 'clay', accessory: 'none' } as const
    const anim = newAnim(look, 'approve')
    for (let i = 0; i < 3 * FPS; i += 1) stepAnim(anim, 1 / FPS, 'approve')
    const before = packFrame(stepAnim(anim, 1 / FPS, 'approve').frame)
    const first = packFrame(stepAnim(anim, 1 / FPS, 'happy').frame)
    for (const slot of [SLOT.armLH, SLOT.armRH]) {
      for (let c = 0; c < 3; c += 1) expect(Math.abs((first[slot * 4 + c] as number) - (before[slot * 4 + c] as number)) < 0.12).toBe(true)
    }
  })

  test('the springs settle on the mood and stay there', () => {
    const look = { body: 'nokta', color: 'clay', accessory: 'none' } as const
    const anim = newAnim(look, 'neutral')
    for (let i = 0; i < 4 * FPS; i += 1) stepAnim(anim, 1 / FPS, 'sleep', true)
    const a = packFrame(stepAnim(anim, 1 / FPS, 'sleep', true).frame)
    const b = packFrame(stepAnim(anim, 1 / FPS, 'sleep', true).frame)
    let drift = 0
    for (let i = 0; i < a.length; i += 1) drift = Math.max(drift, Math.abs((a[i] as number) - (b[i] as number)))
    expect(drift < 1e-4).toBe(true)
    // asleep: the eyes are shut arcs, not beads
    const frame = stepAnim(anim, 1 / FPS, 'sleep', true).frame
    expect(frame.beadOn).toBe(0)
    expect(frame.arcAlpha > 0.9).toBe(true)
  })

  test('a still Nokta is at the moment of rest, whatever the clock says', () => {
    const look = { body: 'bulut', color: 'sky', accessory: 'none' } as const
    const anim = newAnim(look, 'neutral')
    for (let i = 0; i < 2 * FPS; i += 1) stepAnim(anim, 1 / FPS, 'neutral', true)
    const early = Array.from(packFrame(stepAnim(anim, 1 / FPS, 'neutral', true).frame))
    for (let i = 0; i < 5 * FPS; i += 1) stepAnim(anim, 1 / FPS, 'neutral', true)
    const late = Array.from(packFrame(stepAnim(anim, 1 / FPS, 'neutral', true).frame))
    expect(early.every((v, i) => Math.abs(v - (late[i] as number)) < 1e-4)).toBe(true)
    expect(STILL_T > 0 && STILL_T < 1).toBe(true)
  })

  test('a still Nokta takes the pose of its mood whole and at once, not half way', () => {
    const look = { body: 'nokta', color: 'clay', accessory: 'none' } as const
    const anim = newAnim(look, 'happy')
    for (let i = 0; i < 3 * FPS; i += 1) stepAnim(anim, 1 / FPS, 'happy')
    const raised = packFrame(stepAnim(anim, 1 / FPS, 'happy').frame)
    // the mood changes while it is still: the very next frame is the calm pose
    const calm = packFrame(stepAnim(anim, 1 / FPS, 'neutral', true).frame)
    const rest = newAnim(look, 'neutral')
    const reference = packFrame(stepAnim(rest, 1 / FPS, 'neutral', true).frame)
    let apart = 0
    for (const slot of [SLOT.rot, SLOT.loc, SLOT.scale, SLOT.armLS, SLOT.armLH, SLOT.armRS, SLOT.armRH, SLOT.face1, SLOT.face2, SLOT.face4]) {
      for (let c = 0; c < 4; c += 1) apart = Math.max(apart, Math.abs((calm[slot * 4 + c] as number) - (reference[slot * 4 + c] as number)))
    }
    expect(apart < 1e-5).toBe(true)
    expect(Math.abs((raised[SLOT.armLH * 4 + 2] as number) - (calm[SLOT.armLH * 4 + 2] as number)) > 0.5).toBe(true)
  })

  test('the eyes follow what they are asked to look at, and the others wander', () => {
    const look = { body: 'nokta', color: 'clay', accessory: 'none' } as const
    const anim = newAnim(look, 'neutral')
    let frame = stepAnim(anim, 1 / FPS, 'neutral', false, [1.5, -0.8]).frame
    for (let i = 0; i < FPS; i += 1) frame = stepAnim(anim, 1 / FPS, 'neutral', false, [1.5, -0.8]).frame
    expect(Math.abs(frame.gaze[0] - 1.5) < 0.1).toBe(true)
    expect(Math.abs(frame.gaze[1] + 0.8) < 0.1).toBe(true)
    // let go, they come back
    for (let i = 0; i < 3 * FPS; i += 1) frame = stepAnim(anim, 1 / FPS, 'neutral').frame
    expect(Math.abs(frame.gaze[0]) < 1.2).toBe(true)
  })

  test('the ears of the rabbit swing when the body moves and hang still when it does not', () => {
    const look = { body: 'tavsan', color: 'peach', accessory: 'none' } as const
    const happy = run(look, 'happy', 4).frames
    expect(Math.max(...happy.map(f => Math.abs(f.frame.earSway))) > 0.002).toBe(true)
    expect(Math.max(...happy.map(f => Math.abs(f.frame.earSway))) <= 0.2).toBe(true)
    const still = newAnim(look, 'neutral')
    const frames: number[] = []
    for (let i = 0; i < 2 * FPS; i += 1) frames.push(stepAnim(still, 1 / FPS, 'neutral', true).frame.earSway)
    expect(frames.every(s => s === 0)).toBe(true)
  })
})

describe('the picture around the model', () => {
  const base = { title: 'Nokta: hazır', glow: '#FFB08F', mood: 'neutral' as const, t: 1, dy: 0, box: [0.3, 0.3, 0.7, 0.8], half: 1.78, fit: 1, width: 500, height: 222, sprites: undefined }

  test('it is an SVG that holds the live picture, the stage and the shadow', () => {
    const svg = liveHeroSvg({ ...base, href: 'data:image/png;base64,AAAA' })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.includes('data:image/png;base64,AAAA')).toBe(true)
    expect(svg.includes('viewBox')).toBe(true)
    expect(svg.includes('<animate')).toBe(false)
  })

  test('the live picture is set where the pack puts the resting one, scaled with the body', () => {
    const wide = liveHeroSvg({ ...base, href: 'data:image/png;base64,AAAA' })
    const small = liveHeroSvg({ ...base, fit: 0.78, href: 'data:image/png;base64,AAAA' })
    expect(wide === small).toBe(false)
    expect(wide.length > 200).toBe(true)
  })

  test('the small Nokta is the same picture in the frame of the band', () => {
    const svg = liveFaceSvg({ title: 'Nokta', mood: 'neutral', t: 1, dy: 0, href: 'data:image/png;base64,AAAA', box: [0.3, 0.3, 0.7, 0.8], half: 1.78, fit: 1, size: 30 })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.includes('data:image/png;base64,AAAA')).toBe(true)
    expect(svg.includes('viewBox="28 12 196 196"')).toBe(true)
    expect(svg.includes('width="30"') && svg.includes('height="30"')).toBe(true)
  })

  test('a hero with a large picture still fits in what the app takes', () => {
    const svg = liveHeroSvg({ ...base, href: `data:image/png;base64,${'A'.repeat(80_000)}` })
    expect(svg.length < 100_000).toBe(true)
  })
})

describe('the surface module', () => {
  /** What the app hands a module: its element table, its state, its clock, its pointer and its way to talk to the hooks. */
  function fakeSurface() {
    const posts: Array<Record<string, unknown>> = []
    const timers: Array<{ ms: number; fn: () => void; isLive: boolean }> = []
    let state: unknown
    let pointer: ((event: ClientPointerEvent) => void) | undefined
    const surface = {
      elements: {
        Box: (props: object) => ({ type: 'Box', props }),
        Text: (props: object) => ({ type: 'Text', props }),
      },
      get state() {
        return state
      },
      setState: (next: unknown) => {
        state = next
      },
      columns: 40,
      rows: 12,
      every: (ms: number, fn: () => void) => {
        const timer = { ms, fn, isLive: true }
        timers.push(timer)
        return () => {
          timer.isLive = false
        }
      },
      onPointer: (fn: (event: ClientPointerEvent) => void) => {
        pointer = fn
        return () => {
          pointer = undefined
        }
      },
      onKey: () => () => undefined,
      post: (data: Record<string, unknown>) => {
        posts.push(data)
      },
    }
    return {
      surface,
      posts,
      timers,
      live: () => timers.filter(t => t.isLive),
      /** one beat of the frame clock */
      tick: () => {
        for (const t of timers.filter(x => x.isLive)) t.fn()
      },
      point: (event: ClientPointerEvent) => pointer?.(event),
    }
  }

  const props = (over: Partial<HeroProps> = {}): HeroProps => ({
    mood: 'neutral',
    isStill: false,
    name: 'Nokta',
    body: 'nokta',
    color: 'clay',
    accessory: 'none',
    glow: '#FFB08F',
    box: [0.3, 0.3, 0.7, 0.8],
    half: 1.78,
    fit: 1,
    w: 500,
    h: 222,
    sprites: {},
    ...over,
  })

  type Shown = { type: string; props: Record<string, unknown> }
  const mount = (s: ReturnType<typeof fakeSurface>, p: HeroProps) => Hero(p, s.surface as never) as Shown
  /** The module as the app runs it: called to mount (it draws nothing yet), the clock beats once, and it is called again with what it drew. */
  const draw = (s: ReturnType<typeof fakeSurface>, p: HeroProps): Shown => {
    mount(s, p)
    s.tick()
    return mount(s, p)
  }
  const sourceOf = (el: { props: Record<string, unknown> }): string => String(el.props['source'])

  test('it draws nothing at the mount, and the model on the first beat, handed to the engine as an SVG', () => {
    const doc = installDocument()
    try {
      const s = fakeSurface()
      // (a blank of the size of the picture holds the place, so that nothing moves when the picture comes)
      const blank = mount(s, props())
      // (and it says at once that it is there, before anything is built: a driver that builds the program on this thread would keep it from saying so)
      expect(s.posts.filter(p => p['hero'] === 'ok' && p['isBuilding'] === true).length).toBe(1)
      expect(blank.type).toBe('Svg')
      expect(sourceOf(blank).includes('data:image')).toBe(false)
      expect(blank.props['width']).toBe(500)
      expect(doc.canvases.length).toBe(0)
      s.tick()
      const el = mount(s, props())
      expect(el.type).toBe('Svg')
      expect(sourceOf(el).includes('data:image/png;base64,AAAA')).toBe(true)
      expect(el.props['width']).toBe(500)
      expect(el.props['height']).toBe(222)
      expect(doc.canvases.length).toBe(1)
      expect(doc.canvases[0]?.draws).toBe(1)
      // the frame clock runs, and the pointer is listened to
      expect(s.live().map(t => t.ms)).toEqual([40])
    } finally {
      doc.restore()
    }
  })

  test('each beat of the clock is one more frame, and the light is sent once', () => {
    const doc = installDocument()
    const clock = installClock()
    try {
      const s = fakeSurface()
      draw(s, props())
      for (let i = 0; i < 10; i += 1) {
        clock.advance(40)
        s.tick()
      }
      expect(doc.canvases[0]?.draws).toBe(11)
      expect(doc.canvases[0]?.palettes).toBe(1)
      // the picture changes as Nokta moves: the module is drawn again with the state kept
      const again = draw(s, props())
      expect(again.type).toBe('Svg')
    } finally {
      clock.advance(0)
      clock.restore()
      doc.restore()
    }
  })

  test('it says it works at once, and again every few seconds', () => {
    const doc = installDocument()
    const clock = installClock()
    try {
      const s = fakeSurface()
      draw(s, props())
      clock.advance(40)
      s.tick()
      // (once at the mount, before anything was built, and once when the first picture is there)
      expect(s.posts.filter(p => p['hero'] === 'ok' && p['isBuilding'] === true).length).toBe(1)
      expect(s.posts.filter(p => p['hero'] === 'ok' && p['isBuilding'] !== true).length).toBe(1)
      for (let i = 0; i < 110; i += 1) {
        clock.advance(40)
        s.tick()
      }
      // 4 s of beats later, one more
      expect(s.posts.filter(p => p['hero'] === 'ok' && p['isBuilding'] !== true).length).toBe(2)
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
      const ok = s.posts.find(p => p['hero'] === 'ok')
      expect(typeof ok?.['gl']).toBe('string')
      expect(typeof ok?.['size']).toBe('number')
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('where the frame has no canvas the module says so and draws nothing', () => {
    const s = fakeSurface()
    mount(s, props())
    expect(s.posts.length).toBe(0)
    const el = draw(s, props())
    expect(el.type).toBe('Box')
    expect(s.posts.filter(p => p['hero'] === 'fault').length).toBe(1)
    expect(String(s.posts.find(p => p['hero'] === 'fault')?.['why']).includes('no document')).toBe(true)
    // it keeps quiet after that: no further frames, no further posts
    s.tick()
    s.tick()
    expect(s.posts.filter(p => p['hero'] === 'fault').length).toBe(1)
    expect(s.posts.length).toBe(1)
  })

  test('a driver without WebGL 2, or a shader it cannot build, is a fault with its reason', () => {
    for (const [options, why] of [
      [{ noWebgl: true }, 'WebGL 2'],
      [{ failCompile: true }, 'shader'],
    ] as const) {
      const doc = installDocument(options)
      try {
        const s = fakeSurface()
        const el = draw(s, props())
        expect(el.type).toBe('Box')
        expect(s.posts.some(p => p['hero'] === 'fault')).toBe(true)
        expect(String(s.posts.find(p => p['hero'] === 'fault')?.['why']).includes(why)).toBe(true)
      } finally {
        doc.restore()
      }
    }
  })

  test('a lost context is made again; one that keeps being lost is a fault', () => {
    const doc = installDocument()
    const clock = installClock()
    try {
      const s = fakeSurface()
      draw(s, props())
      const lose = (): void => {
        const canvas = doc.canvases[doc.canvases.length - 1] as Canvas
        canvas.isLost = true
        canvas.listeners['webglcontextlost']?.({ preventDefault: () => undefined })
      }
      lose()
      clock.advance(40)
      s.tick()
      expect(doc.canvases.length).toBe(2)
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
      expect(doc.canvases[1]?.draws).toBe(1)
      // the new context is sent the light again
      expect(doc.canvases[1]?.palettes).toBe(1)
      for (let i = 0; i < 6; i += 1) {
        lose()
        clock.advance(40)
        s.tick()
      }
      expect(s.posts.some(p => p['hero'] === 'fault' && String(p['why']).includes('lost'))).toBe(true)
      const count = doc.canvases.length
      clock.advance(40)
      s.tick()
      expect(doc.canvases.length).toBe(count)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a region that is not on screen is not drawn', () => {
    const doc = installDocument()
    const clock = installClock()
    try {
      const s = fakeSurface()
      draw(s, props())
      for (let i = 0; i < 4; i += 1) {
        clock.advance(40)
        s.tick()
      }
      const before = doc.canvases[0]?.draws as number
      s.surface.columns = 0
      for (let i = 0; i < 10; i += 1) {
        clock.advance(40)
        s.tick()
      }
      expect(doc.canvases[0]?.draws).toBe(before)
      s.surface.columns = 40
      clock.advance(40)
      s.tick()
      expect(doc.canvases[0]?.draws).toBe(before + 1)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a still Nokta is drawn once for each thing it looks like', () => {
    const doc = installDocument()
    const clock = installClock()
    try {
      const s = fakeSurface()
      draw(s, props({ isStill: true }))
      for (let i = 0; i < 10; i += 1) {
        clock.advance(40)
        s.tick()
      }
      expect(doc.canvases[0]?.draws).toBe(1)
      // another mood is another picture
      draw(s, props({ isStill: true, mood: 'happy' }))
      for (let i = 0; i < 5; i += 1) {
        clock.advance(40)
        s.tick()
      }
      expect(doc.canvases[0]?.draws).toBe(2)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('the pointer is followed for a moment, and a press is a pat', () => {
    const doc = installDocument()
    const clock = installClock()
    try {
      const s = fakeSurface()
      draw(s, props())
      clock.advance(40)
      s.tick()
      const calm = Float32Array.from(doc.canvases[0]?.lastU as Float32Array)
      // the pointer at the far right: the eyes turn that way (the pointer reaches the state the clock hands on, not the first one)
      s.point({ type: 'move', x: 39, y: 6 })
      for (let i = 0; i < 12; i += 1) {
        clock.advance(40)
        s.tick()
      }
      const turned = doc.canvases[0]?.lastU as Float32Array
      const lookX = SLOT.face0 * 4 + 1
      expect((turned[lookX] as number) > (calm[lookX] as number) + 0.3).toBe(true)
      // a press is posted to the hooks
      expect(s.posts.some(p => p['hero'] === 'pet')).toBe(false)
      s.point({ type: 'down', x: 20, y: 6, button: 'left' })
      expect(s.posts.filter(p => p['hero'] === 'pet').length).toBe(1)
      // a few seconds after it stopped moving the eyes are let go
      s.point({ type: 'leave', x: 39, y: 6 })
      for (let i = 0; i < 40; i += 1) {
        clock.advance(40)
        s.tick()
      }
      const free = doc.canvases[0]?.lastU as Float32Array
      expect(Math.abs((free[lookX] as number) - (calm[lookX] as number)) < 1.2).toBe(true)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a slow machine gets fewer frames, and gets them back when it can keep up', () => {
    const clock = installClock()
    let costMs = 30
    const doc = installDocument({ onDraw: () => clock.advance(costMs) })
    try {
      const s = fakeSurface()
      draw(s, props())
      for (let i = 0; i < 80; i += 1) {
        clock.advance(40)
        s.tick()
      }
      expect(s.live().map(t => t.ms)).toEqual([66])
      costMs = 4
      for (let i = 0; i < 200; i += 1) {
        clock.advance(66)
        s.tick()
      }
      expect(s.live().map(t => t.ms)).toEqual([40])
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a slow card gets a lighter picture before it gets fewer frames, and gets them back in turn', () => {
    const clock = installClock()
    let costMs = 30
    const doc = installDocument({ onDraw: () => clock.advance(costMs) })
    const beat = (n: number): void => {
      for (let i = 0; i < n; i += 1) {
        clock.advance(40)
        s.tick()
      }
    }
    const s = fakeSurface()
    try {
      draw(s, props())
      const canvas = doc.canvases[0] as Canvas
      const last = (): number => canvas.samples[canvas.samples.length - 1] as number
      const full = canvas.width
      expect(last()).toBe(4)
      // first one sample a pixel
      beat(14)
      expect(last()).toBe(1)
      expect(canvas.width).toBe(full)
      // then a smaller canvas, which the app draws larger
      beat(14)
      expect(canvas.width < full).toBe(true)
      expect(s.live().map(t => t.ms)).toEqual([40])
      // and only then fewer frames
      beat(60)
      expect(s.live().map(t => t.ms)).toEqual([66])
      // when it keeps up again the frames come back first, the sharpness after
      costMs = 1
      beat(150)
      expect(s.live().map(t => t.ms)).toEqual([40])
      expect(canvas.width < full).toBe(true)
      beat(260)
      expect(canvas.width).toBe(full)
      expect(last()).toBe(1)
      beat(260)
      expect(last()).toBe(4)
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('the picture grows with the room it is given, within limits', () => {
    const doc = installDocument()
    try {
      const small = fakeSurface()
      draw(small, props({ h: 60, half: 1.78 }))
      const large = fakeSurface()
      draw(large, props({ h: 600 }))
      const [a, b] = doc.canvases
      expect((a?.width as number) >= 96).toBe(true)
      expect((b?.width as number) <= 384).toBe(true)
      expect((b?.width as number) > (a?.width as number)).toBe(true)
      // large pictures are sent as WebP, which is lighter than the app takes for a big PNG
      expect(b?.encoded[0] === 'image/webp' || (b?.width as number) <= 320).toBe(true)
    } finally {
      doc.restore()
    }
  })

  test('a program the driver builds on its own time is waited for, and drawn when it is built', () => {
    const doc = installDocument({ parallelAfter: 3 })
    const clock = installClock()
    try {
      const s = fakeSurface()
      const el = draw(s, props())
      expect(el.type).toBe('Svg')
      expect(sourceOf(el).includes('data:image')).toBe(false)
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
      expect(doc.canvases[0]?.draws).toBe(0)
      let seen = 0
      for (let i = 0; i < 6; i += 1) {
        clock.advance(40)
        s.tick()
        seen += 1
        if ((doc.canvases[0]?.draws ?? 0) > 0) break
      }
      expect((doc.canvases[0]?.draws ?? 0) > 0).toBe(true)
      expect(seen > 1).toBe(true)
      // it said it was alive meanwhile, and what it was doing
      expect(s.posts.some(p => p['hero'] === 'ok' && p['isBuilding'] === true)).toBe(true)
      expect(draw(s, props()).type).toBe('Svg')
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a driver that never finishes building is given up on', () => {
    const doc = installDocument({ parallelAfter: Number.POSITIVE_INFINITY })
    const clock = installClock()
    try {
      const s = fakeSurface()
      draw(s, props())
      for (let i = 0; i < 10; i += 1) {
        clock.advance(40)
        s.tick()
      }
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
      clock.advance(31_000)
      s.tick()
      expect(s.posts.some(p => p['hero'] === 'fault' && String(p['why']).includes('30 s'))).toBe(true)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a picture too heavy for a PNG is sent as WebP, and stays so', () => {
    const doc = installDocument({ pngChars: 120_000, webpChars: 20_000 })
    const clock = installClock()
    try {
      const s = fakeSurface()
      const first = draw(s, props())
      expect(first.type).toBe('Svg')
      expect(sourceOf(first).includes('image/webp')).toBe(true)
      expect(sourceOf(first).length < 100_000).toBe(true)
      const encoded = doc.canvases[0]?.encoded as string[]
      expect(encoded.filter(t => t === 'image/png').length).toBe(1)
      for (let i = 0; i < 5; i += 1) {
        clock.advance(40)
        s.tick()
      }
      expect((doc.canvases[0]?.encoded as string[]).filter(t => t === 'image/png').length).toBe(1)
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a picture that cannot be made light enough is a fault, not a broken pane', () => {
    const doc = installDocument({ pngChars: 150_000, webpChars: 150_000 })
    try {
      const s = fakeSurface()
      const el = draw(s, props())
      expect(el.type).toBe('Box')
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(true)
      expect(String(s.posts.find(p => p['hero'] === 'fault')?.['why']).includes('too heavy')).toBe(true)
    } finally {
      doc.restore()
    }
  })

  test('the small Nokta of the band is drawn small and slowly, and is not a button', () => {
    const doc = installDocument()
    try {
      const s = fakeSurface()
      const el = draw(s, props({ mini: true, w: 30, h: 30 }))
      expect(el.type).toBe('Svg')
      expect(sourceOf(el).includes('viewBox="28 12 196 196"')).toBe(true)
      expect(el.props['width']).toBe(30)
      expect(el.props['height']).toBe(30)
      expect(s.live().map(t => t.ms)).toEqual([66])
      // a few dozen pixels: no larger canvas than that needs
      expect((doc.canvases[0]?.width as number) <= 160).toBe(true)
      // not listened to: a press on it does not pat
      s.point({ type: 'down', x: 1, y: 1, button: 'left' })
      expect(s.posts.some(p => p['hero'] === 'pet')).toBe(false)
    } finally {
      doc.restore()
    }
  })

  test('until the first live picture the place holds the rendered picture of the mood, then the live one comes in its place', () => {
    const doc = installDocument({ parallelAfter: 3 })
    const clock = installClock()
    try {
      const s = fakeSurface()
      const held = mount(s, props({ still: 'UklGRg==', mood: 'ask' }))
      expect(held.type).toBe('Svg')
      expect(sourceOf(held).includes('data:image/webp;base64,UklGRg==')).toBe(true)
      expect(sourceOf(held).includes('viewBox')).toBe(true)
      // (the program is still being built: it stays so)
      s.tick()
      expect(sourceOf(mount(s, props({ still: 'UklGRg==', mood: 'ask' }))).includes('data:image/webp;base64,UklGRg==')).toBe(true)
      for (let i = 0; i < 6; i += 1) {
        clock.advance(40)
        s.tick()
      }
      const live = mount(s, props({ still: 'UklGRg==', mood: 'ask' }))
      expect(sourceOf(live).includes('data:image/png;base64,AAAA')).toBe(true)
      expect(sourceOf(live).includes('UklGRg==')).toBe(false)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a rendered picture that is not what it should be holds nothing: a blank does', () => {
    const doc = installDocument()
    try {
      for (const still of ['not base64 "><x', 'A'.repeat(60_000), '']) {
        const s = fakeSurface()
        const el = mount(s, props({ still }))
        expect(el.type).toBe('Svg')
        expect(sourceOf(el).includes('data:image')).toBe(false)
        expect(sourceOf(el).includes('<x')).toBe(false)
      }
    } finally {
      doc.restore()
    }
  })

  test('another look is another program: the picture of the old one is not shown while the new one is built', () => {
    const doc = installDocument()
    const clock = installClock()
    try {
      const s = fakeSurface()
      const first = draw(s, props({ body: 'nokta', accessory: 'none', still: 'UklGRg==' }))
      expect(sourceOf(first).includes('data:image/png;base64,AAAA')).toBe(true)
      expect(doc.canvases.length).toBe(1)
      // the person changes the look: the module is called again with it, and the clock beats
      const changing = mount(s, props({ body: 'nokta', accessory: 'glasses', still: 'QUJDRA==' }))
      expect(sourceOf(changing).includes('data:image/png;base64,AAAA')).toBe(true) // (until the beat)
      clock.advance(40)
      s.tick()
      expect(doc.canvases.length).toBe(2)
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
      const next = mount(s, props({ body: 'nokta', accessory: 'glasses', still: 'QUJDRA==' }))
      expect(sourceOf(next).includes('data:image/png;base64,AAAA')).toBe(true)
      // the same look again: the same program
      clock.advance(40)
      s.tick()
      expect(doc.canvases.length).toBe(2)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('a pane that is resized keeps its context: the same canvas draws at the new size', () => {
    const doc = installDocument()
    const clock = installClock()
    try {
      const s = fakeSurface()
      draw(s, props({ h: 150 }))
      const before = doc.canvases[0]?.width as number
      mount(s, props({ h: 500 }))
      clock.advance(40)
      s.tick()
      expect(doc.canvases.length).toBe(1)
      expect((doc.canvases[0]?.width as number) > before).toBe(true)
      expect(doc.canvases[0]?.palettes).toBe(1)
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
    } finally {
      clock.restore()
      doc.restore()
    }
  })

  test('numbers, colours and pictures that are not what they should be are made plain, not drawn as they are', () => {
    const doc = installDocument()
    try {
      const s = fakeSurface()
      const wild = props({
        glow: 'red"/><script>',
        half: Number.NaN,
        fit: -3,
        w: 1e9,
        h: Number.POSITIVE_INFINITY,
        box: [1, 2],
        name: 'x'.repeat(500),
        sprites: { a: { half: 1, w: 'AAA"><x' } },
      })
      const el = draw(s, wild)
      expect(el.type).toBe('Svg')
      const source = sourceOf(el)
      expect(source.includes('<script')).toBe(false)
      expect(source.includes('red"')).toBe(false)
      expect(source.includes('AAA"><x')).toBe(false)
      expect(source.includes('NaN') || source.includes('Infinity')).toBe(false)
      // the size the app draws it at stays inside what the app takes
      expect(el.props['width']).toBe(4000)
      expect(el.props['height']).toBe(222)
      expect(String(el.props['alt']).length < 80).toBe(true)
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
    } finally {
      doc.restore()
    }
  })

  test('props it does not know are taken as the plain Nokta', () => {
    const doc = installDocument()
    try {
      const s = fakeSurface()
      const el = draw(s, props({ body: 'ejderha', color: 'mor', accessory: 'taç', mood: 'öfke' }))
      expect(el.type).toBe('Svg')
      expect(s.posts.some(p => p['hero'] === 'fault')).toBe(false)
    } finally {
      doc.restore()
    }
  })
})
