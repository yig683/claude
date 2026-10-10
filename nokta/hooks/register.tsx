// Nokta: a character that lives inside Claude Code. Its 3D model follows what the session does:
// it works while tools run, raises a hand when a call waits for approval, asks, rejoices,
// worries, sleeps, and it moves (breathes, blinks, hops). Pane, band above the prompt, status line,
// toasts, spinner words, a /nokta command and a light Turkish persona; everything is optional in
// the manifest's userConfig.
//
// Everything that touches `$` lives in this file, as top-level functions: the engine's validator
// follows `$` only through those. The other files (model, art, view) are pure.
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, PluginOptions, Register, RenderSurface, Timer } from 'claude-code'

import type { NoktaJob, NoktaLook, NoktaMood, NoktaStep, NoktaTodo } from '../types'
import type { FramePack, Moment } from './art'
import { avatarSvg, FIT, GLOW, heroSvg, isPack, isSprites, terminalCells } from './art'
import { isLiveLook } from './hero-frame'
import {
  ACCESSORIES,
  ACCESSORY_LABEL,
  BODIES,
  BODY_LABEL,
  cleanNote,
  clip,
  COLORS,
  COLOR_LABEL,
  DEFAULT_COLOR,
  DEFAULT_LOOK,
  describeTool,
  fmtDuration,
  fold,
  HELP,
  isSummon,
  MAX_NOTES,
  memoryText,
  MOOD,
  nextOf,
  normalizeLook,
  parseAccessory,
  parseBody,
  parseColor,
  personaText,
  riskNote,
  spinnerWord,
  summonHint,
  titleOf,
  withBody,
  withNote,
} from './model'
import type { Sprites } from './motion'
import { shotOf } from './motion'
import type { PaneActions } from './view'
import { bandRow, paneBody, statsLine } from './view'

type Dollar = EngineInterface

const PANE = 'nokta'
const MAX_JOBS = 12
const HAPPY_MS = 7000
const LOVE_MS = 3600
/** How long the pictures take to change over when Nokta's mood changes, in seconds. */
const CHANGE_S = 0.35
/** The pose a still Nokta (motion off) and the speaker label stand in: eyes open, mid-breath. */
const STILL_T = 0.4
/** Milliseconds between frames while Nokta moves: quick when it is busy, slow while it dozes. */
const FRAME_MS: Record<NoktaMood, number> = { neutral: 125, work: 100, ask: 100, approve: 100, happy: 100, worry: 100, sleep: 250, love: 100 }
const TERMINAL_FRAME_MS = 125

const moodA = atom({ plugin: 'nokta', key: 'mood' } as const, 'neutral')
const detailA = atom({ plugin: 'nokta', key: 'detail' } as const, '')
const lookA = atom({ plugin: 'nokta', key: 'look' } as const, DEFAULT_LOOK)
const stepsA = atom({ plugin: 'nokta', key: 'steps' } as const, [])
const todosA = atom({ plugin: 'nokta', key: 'todos' } as const, [])
const jobsA = atom({ plugin: 'nokta', key: 'jobs' } as const, [])
const bandHiddenA = atom({ plugin: 'nokta', key: 'isBandHidden' } as const, false)
const quietA = atom({ plugin: 'nokta', key: 'isQuiet' } as const, false)
const notesA = atom({ plugin: 'nokta', key: 'notes' } as const, [])
const stillA = atom({ plugin: 'nokta', key: 'isStill' } as const, false)
/** The live 3D Nokta could not be drawn in the app: the still pictures stand in until the session ends. */
const heroOffA = atom({ plugin: 'nokta', key: 'isHeroOff' } as const, false)
/** Bumped by the animation clock: whatever draws Nokta reads it, so it is drawn again for each frame. */
const frameA = atom({ plugin: 'nokta', key: 'frame' } as const, 0)

type Settings = {
  isPersona: boolean
  band: 'hep' | 'etkinken' | 'kapali'
  isAutoOpen: boolean
  isGreeting: boolean
  isRiskNote: boolean
  isSound: boolean
  isMotion: boolean
  isMemory: boolean
  isMessages: boolean
  /** the desktop app draws the 3D model itself, frame after frame (where it can) */
  isLive3d: boolean
  sleepMs: number
}

// The module's own variables start over on a hot reload; everything that matters is in `$.state`.
let opt: Settings = {
  isPersona: true,
  band: 'hep',
  isAutoOpen: true,
  isGreeting: true,
  isRiskNote: true,
  isSound: false,
  isMotion: true,
  isMemory: true,
  isMessages: true,
  isLive3d: true,
  sleepMs: 20 * 60_000,
}
let lastActiveAt = -1
let isTurnActive = false
let hasGreeted = false
let pets = 0
let tick: Timer | undefined
let tickMs = 1000
// the animation: when it began, the mood being shown and the one it is changing from, the timers, who is looking
let epoch = -1
let shownMood: NoktaMood = 'neutral'
let fromMood: NoktaMood = 'neutral'
let changedAt = 0
let frameTimer: Timer | undefined
let frameEvery = 0
let terminalTimer: Timer | undefined
let lastTerminalFrame = ''
let paneAt = -1e9
// the live picture: when it last said it works, whether the pane draws it, whether it is being waited for
let heroOkAt = -1
let paneLive = false
let bandLive = false
let heroDiagKept = ''
let livePetAt = -1e9
let heroWatch = false
const packs = new Map<string, Promise<FramePack | undefined>>()
let spritesOnce: Promise<Sprites | undefined> | undefined
const cellCache = new WeakMap<FramePack, Map<string, { cells: string; columns: number; rows: number } | undefined>>()
const svgCache = new Map<string, string>()

function readSettings(options: PluginOptions): Settings {
  const band = options['band']
  return {
    isPersona: options['persona'] !== 'kapali',
    band: band === 'kapali' || band === 'etkinken' ? band : 'hep',
    isAutoOpen: options['autoOpen'] !== false,
    isGreeting: options['greet'] !== false,
    isRiskNote: options['riskNotes'] !== false,
    isSound: options['sound'] === true,
    isMotion: options['motion'] !== false,
    isMemory: options['memory'] !== false,
    isMessages: options['messages'] !== false,
    isLive3d: options['live'] !== false,
    sleepMs: Math.max(1, Number(options['sleepMinutes']) || 20) * 60_000,
  }
}

/** The character must never get in the way of the work: a failure of ours is swallowed. */
async function safe(fn: () => unknown): Promise<void> {
  try {
    await fn()
  } catch {
    // nothing to do: the next event repaints
  }
}

/** What `fn` makes, or nothing if it throws: a picture that cannot be drawn must not take the whole pane with it. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readJobs(raw: unknown): NoktaJob[] {
  if (!Array.isArray(raw)) return []
  const jobs: NoktaJob[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const status = item['status']
    jobs.push({
      id: typeof item['id'] === 'string' ? item['id'] : String(jobs.length),
      title: typeof item['title'] === 'string' ? clip(item['title'], 80) : 'İş',
      // a job a previous process left running did not finish
      status: status === 'ok' || status === 'err' ? status : 'stop',
      startedAt: typeof item['startedAt'] === 'number' ? item['startedAt'] : 0,
      seconds: typeof item['seconds'] === 'number' ? item['seconds'] : 0,
      tools: typeof item['tools'] === 'number' ? item['tools'] : 0,
    })
  }
  return jobs.slice(0, MAX_JOBS)
}

// ------------------------------------------------------------------ assets and animation

const lookKey = (look: NoktaLook): string => `${look.body}-${look.color}-${look.accessory}`

/** One look's rendered pictures (assets/looks/<look>.json), read once; `undefined` where the file is not there. */
function readPack($: Dollar, key: string): Promise<FramePack | undefined> {
  let hit = packs.get(key)
  if (hit === undefined) {
    hit = (async () => {
      try {
        const text = await $.fs.read(`${$.plugin.root}/assets/looks/${key}.json`)
        const value: unknown = JSON.parse(typeof text === 'string' ? text : '')
        return isPack(value) ? value : undefined
      } catch {
        return undefined
      }
    })()
    if (packs.size >= 4) {
      const oldest = packs.keys().next().value
      if (oldest !== undefined) packs.delete(oldest)
    }
    packs.set(key, hit)
  }
  return hit
}

/** The small 3D things that float around Nokta (assets/props.json), read once; none where the file is not there. */
function loadSprites($: Dollar): Promise<Sprites | undefined> {
  if (spritesOnce === undefined) {
    spritesOnce = (async () => {
      try {
        const text = await $.fs.read(`${$.plugin.root}/assets/props.json`)
        const value: unknown = JSON.parse(typeof text === 'string' ? text : '')
        return isSprites(value) ? value : undefined
      } catch {
        return undefined
      }
    })()
  }
  return spritesOnce
}

/** The pictures of a look: its own, else the same one undressed, else its body in the body's own colour. */
async function loadPack($: Dollar, look: NoktaLook): Promise<FramePack | undefined> {
  const tries = [lookKey(look), lookKey({ ...look, accessory: 'none' }), lookKey({ ...look, color: DEFAULT_COLOR[look.body], accessory: 'none' })]
  for (const key of tries) {
    const pack = await readPack($, key)
    if (pack !== undefined) return pack
  }
  return undefined
}

/** Where the animation is now: seconds since it began, and how far a change of mood has come. */
async function momentNow($: Dollar, mood: NoktaMood, isStill = false): Promise<Moment> {
  if (isStill) return { mood, t: STILL_T }
  const now = await $.clock.now()
  if (epoch < 0) epoch = now
  const t = (now - epoch) / 1000
  if (mood !== shownMood) {
    fromMood = shownMood
    shownMood = mood
    changedAt = t
  }
  const k = (t - changedAt) / CHANGE_S
  return k < 1 && fromMood !== mood ? { mood, t, from: { mood: fromMood, k } } : { mood, t }
}

/** Terminal cells of one picture, kept: the cells of a picture never change. */
function cellsOf(pack: FramePack, frame: string): { cells: string; columns: number; rows: number } | undefined {
  let byFrame = cellCache.get(pack)
  if (byFrame === undefined) {
    byFrame = new Map()
    cellCache.set(pack, byFrame)
  }
  if (!byFrame.has(frame)) byFrame.set(frame, terminalCells(pack, frame))
  return byFrame.get(frame)
}

/** Nokta's picture on the terminal: colour cells of the 3D model; only the pane has one there. */
async function terminalAvatar($: Dollar, table: unknown, look: NoktaLook, mood: NoktaMood): Promise<JSX.Element> {
  const m = MOOD[mood]
  const { Raster, Text } = table as Elements['terminal']
  const pack = await loadPack($, look)
  const frame = shotOf(mood, STILL_T).frame
  lastTerminalFrame = frame
  const art = pack === undefined ? undefined : cellsOf(pack, frame)
  if (art !== undefined) return <Raster key="nokta-avatar" columns={art.columns} rows={art.rows} cells={art.cells} />
  return (
    <Text bold color={m.color}>
      {m.face}
    </Text>
  )
}

/**
 * A small picture of Nokta for the remote surfaces (the band's, the speaker label's). A still SVG, never an
 * "interactive" one: the surface draws that kind in a sandboxed frame with a white background that also
 * refuses pictures. The band moves (each frame is a new picture); the label stands still.
 */
async function smallAvatar(
  $: Dollar,
  table: unknown,
  look: NoktaLook,
  mood: NoktaMood,
  px: number,
  isLive: boolean,
): Promise<JSX.Element | undefined> {
  const { Svg } = table as Elements['desktop']
  const pack = await loadPack($, look)
  if (pack === undefined) return undefined
  let source: string | undefined
  if (isLive) {
    // with no clock running nothing would ever redraw it: it stands in the calm pose, not in a blink
    const isMoving = frameTimer !== undefined && !(await read($, stillA))
    source = avatarSvg(look, pack, await momentNow($, mood, !isMoving), px, await loadSprites($))
  } else {
    const cacheKey = `${lookKey(look)}|${px}|${look.name}`
    source = svgCache.get(cacheKey)
    if (source === undefined) {
      source = avatarSvg(look, pack, { mood: 'neutral', t: STILL_T }, px)
      if (svgCache.size > 40) svgCache.clear()
      svgCache.set(cacheKey, source)
    }
  }
  return <Svg source={source} alt={`${look.name}: ${MOOD[mood].label}`} width={px} height={px} />
}

/** The pane's top picture in the apps: the 3D Nokta on a soft stage. */
async function heroFor($: Dollar, table: unknown, look: NoktaLook, mood: NoktaMood, columns: number): Promise<JSX.Element | undefined> {
  const { Svg } = table as Elements['desktop']
  const pack = await loadPack($, look)
  if (pack === undefined) return undefined
  const width = Math.max(160, Math.round(columns * 8) - 8)
  const height = Math.min(240, Math.round(width * 0.95))
  const at = await momentNow($, mood, await read($, stillA))
  const source = heroSvg(look, pack, at, width, height, await loadSprites($))
  return <Svg source={source} alt={`${look.name}: ${MOOD[mood].label}`} width={width} height={height} />
}

/**
 * The pane's top picture in the desktop app: a region the app itself draws the 3D model into, frame after frame
 * (hero.ts), so the pane is not redrawn for each frame and nothing travels between the engine and the app.
 */
async function liveHero($: Dollar, table: unknown, look: NoktaLook, mood: NoktaMood, columns: number, isStill: boolean): Promise<JSX.Element | undefined> {
  const { Client } = table as Elements['desktop']
  const pack = await loadPack($, look)
  if (pack === undefined) return undefined
  const sprites = (await loadSprites($)) ?? {}
  // (nothing here may be called `h`: that is the name of the JSX factory)
  const width = Math.max(160, Math.round(columns * 8) - 8)
  const height = Math.min(240, Math.round(width * 0.95))
  // what stands in the place until the first live picture is drawn: the rendered picture of the mood
  const still = (pack.frames[shotOf(mood, STILL_T).frame] ?? pack.frames['neutral-open'])?.h ?? ''
  return (
    <Client
      key="nokta-hero"
      module="./hero.ts"
      props={{ mood, isStill, name: look.name, body: look.body, color: look.color, accessory: look.accessory, glow: GLOW[look.color], box: [...pack.box], half: pack.half, fit: FIT[look.body] ?? 1, w: width, h: height, sprites, still }}
    />
  )
}

/** The small Nokta of the band in the desktop app: the same region the pane has, drawn small (hero.ts, `mini`). */
async function liveMini($: Dollar, table: unknown, look: NoktaLook, mood: NoktaMood, px: number, isStill: boolean): Promise<JSX.Element | undefined> {
  const { Client } = table as Elements['desktop']
  const pack = await loadPack($, look)
  if (pack === undefined) return undefined
  const sprites = (await loadSprites($)) ?? {}
  const still = (pack.frames[shotOf(mood, STILL_T).frame] ?? pack.frames['neutral-open'])?.s ?? ''
  return (
    <Client
      key="nokta-mini"
      module="./hero.ts"
      props={{ mini: true, mood, isStill, name: look.name, body: look.body, color: look.color, accessory: look.accessory, glow: GLOW[look.color], box: [...pack.box], half: pack.half, fit: FIT[look.body] ?? 1, w: px, h: px, sprites, still }}
    />
  )
}

/** Gives the live picture a few seconds to say it works: one that never starts (an old app, no WebGL) is replaced by the still ones. */
function watchHero($: Dollar): void {
  if (heroWatch || heroOkAt >= 0) return
  heroWatch = true
  $.clock.after(8000, () => {
    void safe(async () => {
      heroWatch = false
      if (heroOkAt < 0 && !(await read($, heroOffA))) await update($, heroOffA, () => true)
    })
  })
}

/** Starts and stops the animation clocks to match who is looking; called each second and whenever that may have changed. */
async function conduct($: Dollar): Promise<void> {
  const [surfaces, isStill, mood, isBandHidden, now] = await Promise.all([
    $.session.surfaces(),
    read($, stillA),
    read($, moodA),
    read($, bandHiddenA),
    $.clock.now(),
  ])
  const isOn = opt.isMotion && !isStill
  // the pane may be closed or hidden: it counts as looked at only while it keeps being drawn; the band is always there,
  // and moves only for a busy mood (a calm Nokta in the band stands still: the pane is where it lives)
  const isBusy = mood !== 'neutral' && mood !== 'sleep'
  // (a band the app draws by itself needs no frames from here either)
  const isBand = opt.band !== 'kapali' && !isBandHidden && isBusy && !bandLive
  // (a pane whose top picture the app draws by itself needs no frames from here)
  const isPaneDrawn = now - paneAt < 1500 && !paneLive
  const wantsApp = isOn && surfaces.some(one => one !== 'terminal') && (isPaneDrawn || isBand)
  // a phone gets its pictures over a network: half as many
  const isPhoneOnly = surfaces.includes('mobile') && !surfaces.includes('desktop') && !surfaces.includes('vscode')
  const ms = isPhoneOnly ? Math.max(FRAME_MS[mood], 250) : FRAME_MS[mood]
  if (!wantsApp || frameEvery !== ms) {
    frameTimer?.cancel()
    frameTimer = undefined
    frameEvery = 0
  }
  if (wantsApp && frameTimer === undefined) {
    frameEvery = ms
    frameTimer = $.clock.every(ms, () => {
      void safe(() => update($, frameA, n => (n + 1) % 1_000_000))
    })
  }
  const panes = surfaces.includes('terminal') ? await $.ui.panes() : []
  const wantsTerminal = isOn && panes.some(pane => pane.id === PANE && pane.isShown && pane.isPlaced)
  if (!wantsTerminal) {
    terminalTimer?.cancel()
    terminalTimer = undefined
  } else if (terminalTimer === undefined) {
    terminalTimer = $.clock.every(TERMINAL_FRAME_MS, () => {
      void safe(() => terminalFrame($))
    })
  }
}

/** One frame of the terminal pane: the picture the director asks for, painted in place when it changed. */
async function terminalFrame($: Dollar): Promise<void> {
  const [look, mood] = await Promise.all([read($, lookA), read($, moodA)])
  const pack = await loadPack($, look)
  if (pack === undefined) return
  const at = await momentNow($, mood)
  const frame = shotOf(mood, at.t).frame
  if (frame === lastTerminalFrame) return
  const art = cellsOf(pack, frame)
  if (art === undefined) return
  lastTerminalFrame = frame
  await $.ui.blit({ requestId: PANE, key: 'nokta-avatar', cells: art.cells, columns: art.columns, rows: art.rows })
}

// ------------------------------------------------------------------ state and display

async function touch($: Dollar): Promise<void> {
  lastActiveAt = await $.clock.now()
}

async function syncStatus($: Dollar): Promise<void> {
  const [mood, detail, look, isHidden] = await Promise.all([
    read($, moodA),
    read($, detailA),
    read($, lookA),
    read($, bandHiddenA),
  ])
  if (isHidden) {
    $.ui.status(undefined)
    return
  }
  const m = MOOD[mood]
  const extra = detail !== '' && mood !== 'neutral' && mood !== 'sleep' ? ` · ${clip(detail, 44)}` : ''
  $.ui.status(`${m.face} ${look.name} · ${m.label}${extra}`)
}

async function showMood($: Dollar, mood: NoktaMood, detail?: string): Promise<void> {
  await update($, moodA, () => mood)
  if (detail !== undefined) await update($, detailA, () => detail)
  await syncStatus($)
  // a mood may change who needs frames (a sleeper needs fewer, the band moves only for an active mood)
  await safe(() => conduct($))
}

/** A toast, unless Nokta was told to be quiet. */
async function toast($: Dollar, text: string, timeoutMs?: number): Promise<void> {
  if (await read($, quietA)) return
  $.ui.toast(text, timeoutMs === undefined ? undefined : { timeoutMs })
}

/**
 * A short message from Nokta: a toast where a screen is attached; a dim line in the transcript where
 * none is (a cloud session viewed from an app is headless: toasts and the status row have nowhere to go).
 */
async function say($: Dollar, mood: NoktaMood, text: string, timeoutMs?: number): Promise<void> {
  if ((await $.session.surfaces()).length > 0) {
    await toast($, text, timeoutMs)
    return
  }
  if (await read($, quietA)) return
  $.ui.log(`${MOOD[mood].face} ${text}`)
}

async function chime($: Dollar, kind: 'approve' | 'done' | 'error'): Promise<void> {
  if (!opt.isSound || (await read($, quietA))) return
  await $.audio.play({ asset: `assets/sounds/${kind}.wav` }).catch(() => undefined)
}

async function saveLook($: Dollar, look: NoktaLook): Promise<void> {
  await update($, lookA, () => look)
  await $.store.set('look', look)
  await syncStatus($)
}

async function editLook($: Dollar, change: (look: NoktaLook) => NoktaLook): Promise<void> {
  await saveLook($, normalizeLook(change(await read($, lookA))))
}

async function savePrefs($: Dollar): Promise<void> {
  const [isBandHidden, isQuiet, isStill] = await Promise.all([read($, bandHiddenA), read($, quietA), read($, stillA)])
  await $.store.set('prefs', { isBandHidden, isQuiet, isStill })
}

async function toggleQuiet($: Dollar): Promise<boolean> {
  const next = await update($, quietA, quiet => !quiet)
  await savePrefs($)
  return next
}

async function toggleStill($: Dollar): Promise<boolean> {
  const next = await update($, stillA, still => !still)
  await savePrefs($)
  await conduct($)
  return next
}

async function toggleBand($: Dollar): Promise<boolean> {
  const next = await update($, bandHiddenA, hidden => !hidden)
  await savePrefs($)
  await syncStatus($)
  return next
}

/** Keeps a note (the person's, or one the model proposed); says what became of it. */
async function remember($: Dollar, text: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const cleaned = cleanNote(text)
  if (!cleaned.ok) return cleaned
  await saveNotes($, withNote(await read($, notesA), cleaned.text))
  return cleaned
}

async function saveNotes($: Dollar, notes: string[]): Promise<void> {
  await update($, notesA, () => notes)
  await $.store.set('notes', notes)
}

/** Drops one note (by its place in the list); resolves what it said, or nothing for a place that is not there. */
async function forgetNote($: Dollar, index: number): Promise<string | undefined> {
  const notes = await read($, notesA)
  const gone = notes[index]
  if (gone === undefined) return undefined
  await saveNotes(
    $,
    notes.filter((_, i) => i !== index),
  )
  return gone
}

function readNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const notes: string[] = []
  for (const item of raw) {
    const cleaned = typeof item === 'string' ? cleanNote(item) : undefined
    if (cleaned?.ok === true) notes.push(cleaned.text)
  }
  return notes.slice(-MAX_NOTES)
}

const PET_LINES = ['Hıh! Bunu sevdim.', 'Teşekkürler, iyi geldi.', 'Çok güzel hissettirdi.', 'Hadi, bir şeye başlayalım mı?']

/** Nokta is petted: it perks up for a moment. */
async function pet($: Dollar, isSilent: boolean): Promise<string> {
  await touch($)
  pets += 1
  const look = await read($, lookA)
  const line = PET_LINES[pets % PET_LINES.length] ?? 'Hıh!'
  await showMood($, 'love', 'sevildi')
  if (!isSilent) await say($, 'love', `${look.name}: ${line}`, 2500)
  await chime($, 'done')
  $.clock.after(LOVE_MS, () => {
    void safe(async () => {
      if (!isTurnActive && (await read($, moodA)) === 'love') await showMood($, 'neutral', '')
    })
  })
  return line
}

function actions($: Dollar): PaneActions {
  return {
    cycleBody: () => editLook($, look => withBody(look, nextOf(BODIES, look.body))),
    cycleColor: () => editLook($, look => ({ ...look, color: nextOf(COLORS, look.color) })),
    cycleAccessory: () => editLook($, look => ({ ...look, accessory: nextOf(ACCESSORIES, look.accessory) })),
    toggleQuiet: async () => {
      await toggleQuiet($)
    },
    toggleStill: async () => {
      await toggleStill($)
    },
    toggleBand: async () => {
      await toggleBand($)
    },
    close: () => $.ui.close({ id: PANE }),
    pet: async () => {
      await pet($, false)
    },
    forget: async index => {
      await forgetNote($, index)
    },
  }
}

/** Opens the pane; resolves why it could not be seated (too narrow, no surface places panes), or nothing. */
async function openPane($: Dollar): Promise<string | undefined> {
  const look = await read($, lookA)
  const opened = await $.ui.open({ id: PANE, title: look.name })
  if (opened.isPlaced) {
    paneAt = await $.clock.now()
    await safe(() => conduct($))
  }
  return opened.isPlaced ? undefined : opened.reason
}

/** The first sight of Nokta in a session: a short hello, and the pane where a pane has room. */
async function welcome($: Dollar, surface: RenderSurface | null): Promise<void> {
  if (hasGreeted) return
  hasGreeted = true
  const look = await read($, lookA)
  const seen = await $.store.get('seen')
  if (opt.isGreeting) {
    await toast(
      $,
      seen === true
        ? `${look.name} burada.`
        : `Merhaba, ben ${look.name}! Bana adımla seslenebilirsin; panelim /nokta ile açılır.`,
      seen === true ? 3000 : 6000,
    )
  }
  await $.store.set('seen', true)
  if (opt.isAutoOpen && (surface === 'terminal' || surface === 'desktop')) {
    void $.ui.open({ id: PANE, title: look.name })
  }
}

/** The state in words: what `/nokta durum` answers, and `/nokta` where no pane can be drawn. */
async function statusText($: Dollar, look: NoktaLook): Promise<string> {
  const [mood, detail, jobs] = await Promise.all([read($, moodA), read($, detailA), read($, jobsA)])
  const m = MOOD[mood]
  const now = await $.clock.now()
  const run = jobs[0]?.status === 'run' ? jobs[0] : undefined
  const lines = [
    `${m.face} ${look.name} · ${m.label}${detail !== '' && mood !== 'neutral' ? ` · ${detail}` : ''}`,
    statsLine({ mood, elapsed: run === undefined ? 0 : (now - run.startedAt) / 1000, jobs }),
  ]
  if (jobs.length > 0) {
    lines.push('', 'Son işler:')
    for (const job of jobs.slice(0, 5)) {
      const glyph = job.status === 'ok' ? '✓' : job.status === 'err' ? '✗' : job.status === 'run' ? '●' : '■'
      lines.push(`  ${glyph} ${clip(job.title, 56)} · ${fmtDuration(job.seconds)} · ${job.tools} araç`)
    }
  }
  return lines.join('\n')
}

const HEADLESS_NOTE =
  "Bu oturumda Nokta'yı çizecek bir ekran bağlı değil (bulutta çalışan bir oturum): panel, bant ve durum satırı burada görünmez; yalnızca sohbet satırları ve bu komut çalışır. Görmek için Claude Code'u kendi bilgisayarında aç ve şunu yaz:\n/plugin install nokta --marketplace yig683/claude"

/** What the session starts with: the saved look, the preferences, the history, the command. */
async function begin($: Dollar, isInteractive: boolean): Promise<void> {
  const [savedLook, savedPrefs, savedJobs, savedNotes, surfaces] = await Promise.all([
    $.store.get('look'),
    $.store.get('prefs'),
    $.store.get('jobs'),
    $.store.get('notes'),
    $.session.surfaces(),
  ])
  const look = normalizeLook(isRecord(savedLook) ? (savedLook as Partial<NoktaLook>) : undefined)
  await update($, lookA, () => look)
  if (isRecord(savedPrefs)) {
    await update($, bandHiddenA, () => savedPrefs['isBandHidden'] === true)
    await update($, quietA, () => savedPrefs['isQuiet'] === true)
    await update($, stillA, () => savedPrefs['isStill'] === true)
  }
  if ((await read($, jobsA)).length === 0) {
    await update($, jobsA, () => readJobs(savedJobs))
  }
  await update($, notesA, () => readNotes(savedNotes))
  await touch($)

  await $.command.register({
    name: 'nokta',
    description: `${look.name}: durumu, görünümü ve işleri (panel, ad, gövde, renk, sessiz)`,
    argumentHint: '[durum|ad|gövde|renk|aksesuar|sessiz|bant|yardım]',
  })

  if (opt.isMemory) {
    // the model asks to remember; the engine's own dialog asks the person; Nokta keeps the line
    await $.tool.register({
      name: 'remember',
      description:
        "Kullanıcının kalıcı bir tercihini ya da bilgisini Nokta'nın hafızasına tek cümleyle kaydeder (sonraki oturumlarda da hatırlanır). Yalnızca kullanıcı açıkça söylediği kalıcı şeyler için; geçici istekler, sırlar, parolalar, anahtarlar için ASLA.",
      inputSchema: {
        type: 'object',
        properties: { note: { type: 'string', description: 'Tek cümle, en çok 200 karakter.' } },
        required: ['note'],
      },
      isDeferred: false,
    })
  }

  await showMood($, 'neutral', '')

  // A person may be at a terminal, or in an app that attaches to the session; either way the
  // engine's `surfaces()` says where Nokta is seen. (An app that attaches later gets `welcome` then.)
  const first = surfaces.find(one => one === 'terminal' || one === 'desktop') ?? surfaces[0] ?? null
  if (isInteractive || first !== null) await welcome($, first)

  // the animation clocks run only while Nokta is looked at; this once a second sees to that
  $.clock.every(1000, () => {
    void safe(() => conduct($))
  })

  // Nokta dozes off when nothing has happened for a while.
  $.clock.every(30_000, async () => {
    if (isTurnActive) return
    const mood = await read($, moodA)
    const now = await $.clock.now()
    if (mood === 'neutral' && lastActiveAt >= 0 && now - lastActiveAt > opt.sleepMs) {
      await safe(() => showMood($, 'sleep', ''))
    }
  })
}

/** A turn begins: a new job, the steps start over, the clock ticks for the pane. */
async function startTurn($: Dollar, turnId: string, text: string): Promise<void> {
  const now = await $.clock.now()
  lastActiveAt = now
  isTurnActive = true
  await update($, stepsA, () => [])
  await update($, jobsA, jobs =>
    [
      { id: turnId, title: titleOf(text), status: 'run', startedAt: now, seconds: 0, tools: 0 } satisfies NoktaJob,
      ...jobs,
    ].slice(0, MAX_JOBS),
  )
  await showMood($, 'work', 'düşünüyor')
  // (a pane the app draws by itself is not redrawn for frames, so its time and its steps are kept up by this)
  tickMs = (await $.session.surfaces()).includes('terminal') || paneLive || bandLive ? 1000 : 4000
  tick?.cancel()
  tick = $.clock.every(tickMs, () => {
    // the animation clock redraws the pane and the band each frame; this is for when it is not running
    if (frameTimer === undefined) $.ui.invalidate('ui.render')
  })
}

/** A turn ends: the job is closed, Nokta rejoices, worries or just rests. */
async function endTurn(
  $: Dollar,
  turnId: string,
  reason: 'answer' | 'aborted' | 'refusal' | 'error',
  durationMs: number,
): Promise<void> {
  tick?.cancel()
  tick = undefined
  isTurnActive = false
  const seconds = durationMs / 1000
  const status = reason === 'answer' ? 'ok' : reason === 'aborted' ? 'stop' : 'err'
  const jobs = await update($, jobsA, list =>
    list.map(job => (job.id === turnId ? { ...job, status, seconds } : job)),
  )
  await update($, stepsA, list =>
    list.map(step => (step.status === 'run' ? { ...step, status: status === 'ok' ? 'ok' : 'err' } : step)),
  )
  await $.store.set('jobs', jobs)
  const tools = jobs.find(job => job.id === turnId)?.tools ?? 0
  const look = await read($, lookA)
  const stats = `${fmtDuration(seconds)} · ${tools} araç`

  if (reason === 'answer') {
    await showMood($, 'happy', stats)
    if (seconds >= 20 || tools >= 3) {
      await say($, 'happy', `${look.name}: tamamladı · ${stats}`)
      await chime($, 'done')
    }
    $.clock.after(HAPPY_MS, () => {
      void safe(async () => {
        if (!isTurnActive && (await read($, moodA)) === 'happy') await showMood($, 'neutral', '')
      })
    })
  } else if (reason === 'aborted') {
    await showMood($, 'neutral', '')
  } else {
    await showMood($, 'worry', reason === 'refusal' ? 'model reddetti' : 'bir hata oluştu')
    await say($, 'worry', `${look.name}: bir sorun var`)
    await chime($, 'error')
  }
}

/** A tool call begins: a step in the pane, the mood, the model's own todo list, a risk note. */
async function beginCall(
  $: Dollar,
  id: string,
  tool: string,
  label: string,
  isSub: boolean,
  input: Record<string, unknown>,
): Promise<void> {
  await touch($)
  await update($, stepsA, list => [...list, { id, label, status: 'run' } satisfies NoktaStep].slice(-40))
  await update($, jobsA, jobs =>
    jobs.map((job, i) => (i === 0 && job.status === 'run' ? { ...job, tools: job.tools + 1 } : job)),
  )
  if (!isSub) await showMood($, tool === 'AskUserQuestion' ? 'ask' : 'work', label)

  if (opt.isRiskNote) {
    const note = riskNote(tool, input)
    // the notice is refused for a call that has no dialog open; that is no reason to stop here
    if (note !== undefined) await safe(async () => $.ui.notice(id, `${(await read($, lookA)).name}: ${note}`))
  }
}

/** A tool call is over: the step closes, and Nokta goes back to work (or notes the failure). */
async function endCall($: Dollar, id: string, label: string, isSub: boolean, isFailed: boolean): Promise<void> {
  await update($, stepsA, list =>
    list.map(step => (step.id === id ? { ...step, status: isFailed ? 'err' : 'ok' } : step)),
  )
  const mood = await read($, moodA)
  if (!isSub && isTurnActive && (mood === 'approve' || mood === 'ask' || mood === 'work')) {
    await showMood($, 'work', isFailed ? `${clip(label, 36)} hata verdi` : 'sıradaki adımı düşünüyor')
  }
}

/** A permission dialog is about to be shown: Nokta raises a hand. */
async function raiseHand($: Dollar, tool: string, input: Record<string, unknown>): Promise<void> {
  if (tool === 'AskUserQuestion') return // that is a question, not an approval: Nokta already asks
  const label = describeTool(tool, input)
  const look = await read($, lookA)
  await showMood($, 'approve', label)
  await say($, 'approve', `${look.name}: onayını bekliyor · ${clip(label, 50)}`)
  await chime($, 'approve')
}

// ------------------------------------------------------------------ the module

export const register: Register = (on, options) => {
  opt = readSettings(options)

  on('session.start', async ($, e, next) => {
    await safe(() => begin($, e.isInteractive))
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await safe(() => welcome($, e.surface))
    return attached
  })

  on('session.end', async ($, e, next) => {
    await safe(async () => {
      await $.store.set('jobs', await read($, jobsA))
      if (e.reason === 'clear') {
        // a new conversation starts: what the old one did on screen no longer applies
        isTurnActive = false
        tick?.cancel()
        tick = undefined
        await update($, stepsA, () => [])
        await update($, todosA, () => [])
        await showMood($, 'neutral', '')
      }
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await safe(() => startTurn($, e.turnId, e.text))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await safe(() => endTurn($, e.turnId, e.reason, e.durationMs))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id
    const isSub = (e as { agentId?: string }).agentId !== undefined
    const label = `${isSub ? '↳ ' : ''}${describeTool(e.tool, input)}`

    await safe(async () => {
      await beginCall($, id, e.tool, label, isSub, input)
      if (e.tool === 'TodoWrite') {
        await update($, todosA, () =>
          e.todos.map(todo => ({ text: todo.content, status: todo.status }) satisfies NoktaTodo),
        )
      } else if (e.tool === 'TaskCreate') {
        await update($, todosA, list =>
          [...list, { text: e.subject, status: 'pending' } satisfies NoktaTodo].slice(-30),
        )
      } else if (e.tool === 'TaskUpdate') {
        const at = Number(e.taskId) - 1
        await update($, todosA, list =>
          list.flatMap((todo, i) => {
            if (i !== at) return [todo]
            if (e.status === 'deleted') return []
            return [{ text: e.subject ?? todo.text, status: e.status ?? todo.status } satisfies NoktaTodo]
          }),
        )
      }
    })

    let isFailed = false
    try {
      const ran = await next(e)
      isFailed = ran.deny !== undefined || ran.isError === true
      return ran
    } catch (error) {
      isFailed = true
      throw error
    } finally {
      await safe(() => endCall($, id, label, isSub, isFailed))
    }
  }).catch(($, e, next) => next(e))

  // The person calls Nokta by its name alone: it is the one being spoken to, not a command to explain.
  on('prompt.submit', async ($, e, next) => {
    const look = await read($, lookA)
    if (!isSummon(e.text, look.name)) return next(e)
    await safe(() => touch($))
    const last = (await read($, jobsA)).find(job => job.status !== 'run')
    return next({ ...e, context: [...(e.context ?? []), summonHint(look.name, last)] })
  }).catch(($, e, next) => next(e))

  // What the model proposes to remember (declared in begin()); the engine's dialog asks the person first.
  // It is registered after the generic hook above, so that one still sees the call as a step.
  on('tool.call', { tool: 'mcp__nokta__remember' }, async ($, e) => {
    const said = (e as unknown as Record<string, unknown>)['note']
    const kept = await remember($, typeof said === 'string' ? said : '')
    if (kept.ok) await safe(() => say($, 'happy', `Nokta hatırladı: ${kept.text}`))
    return { result: kept.ok ? `Kaydedildi: ${kept.text}` : `Kaydedilmedi: ${kept.reason}` }
  }).catch(($, e, next) => next(e))

  // A dialog is about to ask the person: Nokta raises a hand. (The engine's verdict "ask" is not the
  // signal: a mode that approves for itself settles it without anyone being asked. Nothing tells us
  // when they answer; the hand comes down when the call returns.)
  on('classic.PermissionRequest', async ($, e, next) => {
    await safe(() => raiseHand($, e.tool_name, isRecord(e.tool_input) ? e.tool_input : {}))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const sections = [...composed.sections]
    if (opt.isPersona) {
      const look = await read($, lookA)
      sections.push({ id: 'nokta:persona', text: personaText(look.name, opt.isMemory), scope: 'session' as const })
    }
    if (opt.isMemory) {
      const notes = await read($, notesA)
      if (notes.length > 0) sections.push({ id: 'nokta:memory', text: memoryText(notes), scope: 'session' as const })
    }
    return { sections }
  })

  on('command.run', { command: 'nokta' }, async ($, e) => {
    await safe(() => touch($))
    if ((await read($, moodA)) === 'sleep') await safe(() => showMood($, 'neutral', ''))
    const look = await read($, lookA)
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    const sub = fold(word)
    const arg = rest.join(' ').trim()

    if (sub === '' || sub === 'panel' || sub === 'ac') {
      if ((await $.session.surfaces()).length === 0) {
        return { text: `${await statusText($, look)}\n\n${HEADLESS_NOTE}` }
      }
      const why = await openPane($)
      return {
        text:
          why === undefined
            ? `${look.name} paneli açıldı. Komutlar için /nokta yardım.`
            : `${look.name} paneli şimdi yerleşemedi (${why}). Yerleşince kendiliğinden görünür; şimdilik: /nokta durum.`,
      }
    }
    if (sub === 'kapat' || sub === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Panel kapandı.' }
    }
    if (sub === 'durum' || sub === 'status') {
      return { text: await statusText($, look) }
    }
    if (sub === 'sev' || sub === 'pet') {
      const line = await pet($, true)
      return { text: `${MOOD.love.face} ${look.name}: ${line}` }
    }
    if (sub === 'hatirla' || sub === 'remember') {
      if (!opt.isMemory) return { text: 'Hafıza kapalı (ayar: memory).' }
      if (arg === '') return { text: 'Neyi hatırlayayım? Örnek: /nokta hatırla testleri make t ile çalıştırırız' }
      const kept = await remember($, arg)
      return { text: kept.ok ? `Hatırlayacağım: ${kept.text}` : kept.reason }
    }
    if (sub === 'hafiza' || sub === 'memory' || sub === 'notlar') {
      const notes = await read($, notesA)
      return {
        text:
          notes.length === 0
            ? 'Henüz bir şey hatırlamıyorum. Örnek: /nokta hatırla hep Türkçe yaz'
            : `Hatırladıklarım:\n${notes.map((note, i) => `  ${i + 1}. ${note}`).join('\n')}\n\nSilmek için: /nokta unut <no> ya da /nokta unut hepsi`,
      }
    }
    if (sub === 'unut' || sub === 'forget') {
      const which = fold(arg)
      if (which === 'hepsi' || which === 'tumu' || which === 'all') {
        await saveNotes($, [])
        return { text: 'Hepsini unuttum.' }
      }
      const gone = await forgetNote($, Number(which) - 1)
      return {
        text:
          gone === undefined
            ? 'Hangisini? /nokta hafıza ile numaralara bak, sonra /nokta unut <no> yaz.'
            : `Unuttum: ${gone}`,
      }
    }
    if (sub === 'ad' || sub === 'isim' || sub === 'name') {
      if (arg === '') return { text: `Adım şu an ${look.name}. Değiştirmek için: /nokta ad <yeni ad>` }
      const renamed = normalizeLook({ ...look, name: arg })
      await saveLook($, renamed)
      return { text: `Artık adım ${renamed.name}.` }
    }
    if (sub === 'govde' || sub === 'body') {
      const body = parseBody(arg)
      if (body === undefined) {
        return { text: `Gövde: ${BODIES.map(b => BODY_LABEL[b]).join(', ')}. Örnek: /nokta gövde tavşan` }
      }
      await saveLook($, normalizeLook(withBody(look, body)))
      return { text: `Gövde: ${BODY_LABEL[body]}.` }
    }
    if (sub === 'renk' || sub === 'color') {
      if (look.body !== 'nokta') {
        return { text: `${BODY_LABEL[look.body]} gövdesinin rengi sabit; renkler Nokta gövdesinde değişir.` }
      }
      const color = parseColor(arg)
      if (color === undefined) {
        return { text: `Renkler: ${COLORS.map(c => COLOR_LABEL[c]).join(', ')}. Örnek: /nokta renk adaçayı` }
      }
      await saveLook($, normalizeLook({ ...look, color }))
      return { text: `Renk: ${COLOR_LABEL[color]}.` }
    }
    if (sub === 'aksesuar' || sub === 'accessory') {
      if (look.body !== 'nokta') return { text: 'Aksesuarlar yalnızca Nokta gövdesinde.' }
      const accessory = parseAccessory(arg)
      if (accessory === undefined) {
        return { text: `Aksesuarlar: ${ACCESSORIES.map(a => ACCESSORY_LABEL[a]).join(', ')}. Örnek: /nokta aksesuar bere` }
      }
      await saveLook($, normalizeLook({ ...look, accessory }))
      return { text: `Aksesuar: ${ACCESSORY_LABEL[accessory]}.` }
    }
    if (sub === 'sessiz' || sub === 'quiet' || sub === 'mute') {
      const isQuiet = await toggleQuiet($)
      return { text: isQuiet ? 'Sessiz: bildirimler ve sesler kapalı.' : 'Sessiz kapandı: bildirimler açık.' }
    }
    if (sub === 'hareket' || sub === 'motion' || sub === 'animasyon') {
      const isStill = await toggleStill($)
      return { text: isStill ? 'Hareket kapalı: Nokta durağan.' : 'Hareket açık.' }
    }
    if (sub === 'bant' || sub === 'band') {
      const isHidden = await toggleBand($)
      return { text: isHidden ? 'Bant ve durum satırı gizlendi.' : 'Bant ve durum satırı açık.' }
    }
    if (sub === 'tani' || sub === 'diag') {
      const [isOff, diag] = await Promise.all([read($, heroOffA), $.store.get('heroDiag')])
      return { text: `Canlı 3B: ${isOff ? 'kapalı (durağan resimler çiziliyor)' : 'açık'}${diag === undefined ? '' : `\n${JSON.stringify(diag)}`}` }
    }
    if (sub === 'canli' || sub === 'live') {
      if (!opt.isLive3d) return { text: 'Canlı 3B ayarlardan kapalı: Nokta ayarlarında "Canlı 3B" açılırsa denenir.' }
      heroOkAt = -1
      await update($, heroOffA, () => false)
      return { text: 'Canlı 3B yeniden denenecek (panel açıksa hemen).' }
    }
    return { text: HELP }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const U = $.ui.resolve(e)
    const { Text } = U
    const [look, mood, detail, steps, todos, jobs, isQuiet, isBandHidden, notes, isStill, isHeroOff] = await Promise.all([
      read($, lookA),
      read($, moodA),
      read($, detailA),
      read($, stepsA),
      read($, todosA),
      read($, jobsA),
      read($, quietA),
      read($, bandHiddenA),
      read($, notesA),
      read($, stillA),
      read($, heroOffA),
    ])
    const now = await $.clock.now()
    paneAt = now
    const run = jobs[0]?.status === 'run' ? jobs[0] : undefined
    const rows = e.props.scroll.bodyRows
    // a short room (an inline pane, a small window) gets a line of text instead of the big picture
    const isCompact = e.surface === 'terminal' ? rows < 28 : rows < 14
    const elapsed = run === undefined ? 0 : Math.max(0, (now - run.startedAt) / 1000)
    // the desktop app draws the model itself, frame after frame; every other surface is handed pictures for each frame
    const isLive = e.surface === 'desktop' && opt.isLive3d && !isHeroOff && !isCompact && isLiveLook(look)
    paneLive = isLive
    if (!isLive) await read($, frameA) // drawn again for each frame of the animation
    const avatar = isCompact
      ? undefined
      : e.surface === 'terminal'
        ? await attempt(() => terminalAvatar($, U, look, mood))
        : isLive
          ? await attempt(() => liveHero($, U, look, mood, e.props.bodyColumns, isStill || !opt.isMotion))
          : await attempt(() => heroFor($, U, look, mood, e.props.bodyColumns))
    if (isLive && avatar !== undefined) watchHero($)
    return paneBody(
      U,
      {
        look,
        mood,
        detail,
        steps,
        todos,
        jobs,
        notes,
        isMemory: opt.isMemory,
        elapsed,
        columns: e.props.bodyColumns,
        rows,
        isCompact,
        isQuiet,
        isStill,
        isBandHidden,
        isTerminal: e.surface === 'terminal',
      },
      actions($),
      avatar ?? <Text>{MOOD[mood].face}</Text>,
    )
  })

  // What the live picture in the app says of itself: it works, or it cannot draw (no WebGL, a lost context), and
  // then the still pictures stand in for it. (What it says is kept, for whoever has to find out why.)
  on('ui.message', async ($, e, next) => {
    const data = e.data
    if (isRecord(data) && data['hero'] === 'ok') {
      heroOkAt = await $.clock.now()
      // (what is kept is where it draws, how large and how fast: not each beat's count of frames)
      const kept = [data['gl'], data['size'], data['every'], data['isBuilding']].join('|')
      if (kept !== heroDiagKept) {
        heroDiagKept = kept
        await safe(() => $.store.set('heroDiag', data))
      }
    } else if (isRecord(data) && data['hero'] === 'fault') {
      await safe(async () => {
        await $.store.set('heroDiag', data)
        await update($, heroOffA, () => true)
      })
    } else if (isRecord(data) && data['hero'] === 'pet') {
      // a click on the live picture: the same as the pane's own button (but a pointer held down and dragged is not a hundred pats)
      await safe(async () => {
        const now = await $.clock.now()
        if (now - livePetAt < 1000) return
        livePetAt = now
        await pet($, false)
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (opt.band === 'kapali' || e.props.hasSurvey) return next(e)
    const [mood, isHidden] = await Promise.all([read($, moodA), read($, bandHiddenA)])
    if (isHidden) return next(e)
    if (opt.band === 'etkinken' && !e.props.isWorking && mood !== 'ask' && mood !== 'approve' && mood !== 'worry') {
      return next(e)
    }
    const U = $.ui.resolve(e)
    const [look, detail, jobs, isHeroOff, isStill] = await Promise.all([read($, lookA), read($, detailA), read($, jobsA), read($, heroOffA), read($, stillA)])
    const now = await $.clock.now()
    const run = jobs[0]?.status === 'run' ? jobs[0] : undefined
    const isLive = e.surface === 'desktop' && opt.isLive3d && !isHeroOff && isLiveLook(look)
    bandLive = isLive
    if (!isLive) await read($, frameA) // drawn again for each frame of the animation
    // (the small Nokta moves while it is busy and stands still while it is calm, as it always has)
    const isCalm = mood === 'neutral' || mood === 'sleep'
    const face =
      e.surface === 'terminal'
        ? undefined
        : await attempt(() => (isLive ? liveMini($, U, look, mood, 30, isStill || !opt.isMotion || isCalm) : smallAvatar($, U, look, mood, 30, true)))
    if (isLive && face !== undefined) watchHero($)
    return bandRow(
      U,
      {
        look,
        mood,
        detail,
        elapsed: run === undefined ? 0 : Math.max(0, (now - run.startedAt) / 1000),
        tools: run?.tools ?? 0,
        note: statsLine({ mood, elapsed: run === undefined ? 0 : (now - run.startedAt) / 1000, jobs }),
        columns: e.props.bodyColumns,
        isTerminal: e.surface === 'terminal',
      },
      face,
      async () => {
        await openPane($)
      },
    )
  })

  // Each reply opens with Nokta's face and name, as a speaker label: the character is the one speaking, in
  // the chat itself, not only in a panel beside it. Always the calm face (the label must not change with
  // the mood, or every old message would redraw each time Nokta's mood does). The engine draws the reply
  // itself and ours wraps it.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!opt.isMessages || e.surface === 'terminal' || !e.props.isFirstOfReply || e.props.isSummary === true) {
      return next(e)
    }
    const look = await read($, lookA)
    const U = $.ui.resolve(e)
    const face = await attempt(() => smallAvatar($, U, look, 'neutral', 26, false))
    if (face === undefined) return next(e)
    const { Box, Text } = U
    return (
      <Box flexDirection="column" gap={0}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {face}
          <Text bold>{look.name}</Text>
        </Box>
        {await next(e)}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // Turkish words for the spinner line, with Nokta's name in them. (On the desktop the word says
  // what the step is doing, "Creating notes.md": that stays as the engine has it.)
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.message !== null) return next(e)
    const look = await read($, lookA)
    return next({
      ...e,
      props: { ...e.props, word: spinnerWord(look.name, e.props.mode, e.props.word) },
    })
  })

  // The line that closes a turn, in Turkish.
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const look = await read($, lookA)
    return (
      <Text dimColor>
        ✻ {look.name} tamamladı · {fmtDuration(e.props.durationMs / 1000)}
      </Text>
    )
  })
}
