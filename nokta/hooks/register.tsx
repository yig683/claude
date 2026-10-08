// Nokta: a character that lives inside Claude Code. Its face follows what the session does:
// it works while tools run, raises a hand when a call waits for approval, asks, rejoices,
// worries, sleeps. Pane, band above the prompt, status line, toasts, spinner words, a /nokta
// command and a light Turkish persona; everything is optional in the manifest's userConfig.
//
// Everything that touches `$` lives in this file, as top-level functions: the engine's validator
// follows `$` only through those. The other files (model, art, view) are pure.
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, PluginOptions, Register, RenderSurface, Timer } from 'claude-code'

import type { NoktaJob, NoktaLook, NoktaMood, NoktaStep, NoktaTodo } from '../types'
import type { RasterPack } from './art'
import { avatarSvg, b64decode, rasterCells } from './art'
import {
  ACCESSORIES,
  ACCESSORY_LABEL,
  BODIES,
  BODY_LABEL,
  clip,
  COLORS,
  COLOR_LABEL,
  DEFAULT_COLOR,
  DEFAULT_LOOK,
  describeTool,
  fmtDuration,
  fold,
  HELP,
  iconKey,
  MOOD,
  nextOf,
  normalizeLook,
  parseAccessory,
  parseBody,
  parseColor,
  personaText,
  riskNote,
  spinnerWord,
  titleOf,
} from './model'
import type { PaneActions } from './view'
import { bandRow, paneBody, statsLine } from './view'

type Dollar = EngineInterface

const PANE = 'nokta'
const MAX_JOBS = 12
const HAPPY_MS = 7000
const BLINK_EVERY_MS = 4300
const BLINK_MS = 170

const moodA = atom({ plugin: 'nokta', key: 'mood' } as const, 'neutral')
const detailA = atom({ plugin: 'nokta', key: 'detail' } as const, '')
const lookA = atom({ plugin: 'nokta', key: 'look' } as const, DEFAULT_LOOK)
const stepsA = atom({ plugin: 'nokta', key: 'steps' } as const, [])
const todosA = atom({ plugin: 'nokta', key: 'todos' } as const, [])
const jobsA = atom({ plugin: 'nokta', key: 'jobs' } as const, [])
const bandHiddenA = atom({ plugin: 'nokta', key: 'isBandHidden' } as const, false)
const quietA = atom({ plugin: 'nokta', key: 'isQuiet' } as const, false)

type Settings = {
  isPersona: boolean
  band: 'hep' | 'etkinken' | 'kapali'
  isAutoOpen: boolean
  isGreeting: boolean
  isRiskNote: boolean
  isSound: boolean
  isKittyWanted: boolean
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
  isKittyWanted: false,
  sleepMs: 8 * 60_000,
}
let lastActiveAt = -1
let isTurnActive = false
let isKitty = false
let hasGreeted = false
let blinks = 0
let tick: Timer | undefined
let tickMs = 1000
let packOnce: Promise<RasterPack | undefined> | undefined
const pngCache = new Map<string, string | undefined>()
const cellCache = new Map<string, { cells: string; columns: number; rows: number }>()

function readSettings(options: PluginOptions): Settings {
  const band = options['band']
  return {
    isPersona: options['persona'] !== 'kapali',
    band: band === 'kapali' || band === 'etkinken' ? band : 'hep',
    isAutoOpen: options['autoOpen'] !== false,
    isGreeting: options['greet'] !== false,
    isRiskNote: options['riskNotes'] !== false,
    isSound: options['sound'] === true,
    isKittyWanted: options['terminalImages'] === 'kitty',
    sleepMs: Math.max(1, Number(options['sleepMinutes']) || 8) * 60_000,
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

// ------------------------------------------------------------------ assets

/** The raster pack (small RGBA pictures for terminal cells), read once. */
function loadPack($: Dollar): Promise<RasterPack | undefined> {
  if (packOnce === undefined) {
    packOnce = (async () => {
      try {
        const text = await $.fs.read(`${$.plugin.root}/assets/raster.json`)
        const pack = JSON.parse(typeof text === 'string' ? text : '') as RasterPack
        return typeof pack.width === 'number' && typeof pack.height === 'number' ? pack : undefined
      } catch {
        return undefined
      }
    })()
  }
  return packOnce
}

/** The render of a look in a mood as base64 PNG, or `undefined` where the file is not there. */
async function loadPng($: Dollar, look: NoktaLook, mood: NoktaMood): Promise<string | undefined> {
  const key = iconKey(look, mood)
  if (pngCache.has(key)) return pngCache.get(key)
  let value: string | undefined
  try {
    const file = await $.fs.read(`${$.plugin.root}/assets/icons/${key}.png`, { as: 'bytes' })
    value = isRecord(file) && typeof file['base64'] === 'string' ? file['base64'] : undefined
  } catch {
    value = undefined
  }
  if (pngCache.size > 24) pngCache.clear()
  pngCache.set(key, value)
  return value
}

/** The terminal cells of a look in a mood; `undefined` where the pack lacks the picture. */
async function loadCells(
  $: Dollar,
  look: NoktaLook,
  mood: NoktaMood,
): Promise<{ cells: string; columns: number; rows: number } | undefined> {
  const key = iconKey(look, mood)
  const cached = cellCache.get(key)
  if (cached !== undefined) return cached
  const pack = await loadPack($)
  const rgba = pack?.rgba[key]
  if (pack === undefined || rgba === undefined) return undefined
  const art = {
    cells: rasterCells(b64decode(rgba), pack.width, pack.height),
    columns: pack.width,
    rows: Math.ceil(pack.height / 2),
  }
  cellCache.set(key, art)
  return art
}

/** Nokta's picture for a surface: terminal cells (or a kitty image), or an SVG on the others. */
async function avatarFor(
  $: Dollar,
  table: unknown,
  surface: RenderSurface,
  look: NoktaLook,
  mood: NoktaMood,
  size: 'pane' | 'band',
): Promise<JSX.Element | undefined> {
  const m = MOOD[mood]
  if (surface === 'terminal') {
    if (size === 'band') return undefined
    const { Raster, Image, Text } = table as Elements['terminal']
    if (opt.isKittyWanted && isKitty) {
      const png = await loadPng($, look, mood)
      if (png !== undefined) {
        return <Image key="nokta-avatar" source={{ png }} columns={20} rows={10} alt={m.face} />
      }
    }
    const art = await loadCells($, look, mood)
    if (art !== undefined) {
      return <Raster key="nokta-avatar" columns={art.columns} rows={art.rows} cells={art.cells} />
    }
    return (
      <Text bold color={m.color}>
        {m.face}
      </Text>
    )
  }
  const { Svg } = table as Elements['desktop']
  const [png, pack] = await Promise.all([loadPng($, look, mood), loadPack($)])
  const px = size === 'pane' ? 132 : 26
  return (
    <Svg
      source={avatarSvg({
        look,
        mood,
        png,
        disc: pack?.disc[iconKey(look, mood)],
        size: px,
        animated: size === 'pane',
      })}
      alt={`${look.name}: ${m.label}`}
      width={px}
      height={px}
      isInteractive={size === 'pane'}
    />
  )
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
  const [isBandHidden, isQuiet] = await Promise.all([read($, bandHiddenA), read($, quietA)])
  await $.store.set('prefs', { isBandHidden, isQuiet })
}

async function toggleQuiet($: Dollar): Promise<boolean> {
  const next = await update($, quietA, quiet => !quiet)
  await savePrefs($)
  return next
}

async function toggleBand($: Dollar): Promise<boolean> {
  const next = await update($, bandHiddenA, hidden => !hidden)
  await savePrefs($)
  await syncStatus($)
  return next
}

function actions($: Dollar): PaneActions {
  return {
    cycleBody: () =>
      editLook($, look => {
        const body = nextOf(BODIES, look.body)
        return { name: look.name, body, color: body === 'nokta' ? 'clay' : DEFAULT_COLOR[body], accessory: 'none' }
      }),
    cycleColor: () => editLook($, look => ({ ...look, color: nextOf(COLORS, look.color) })),
    cycleAccessory: () => editLook($, look => ({ ...look, accessory: nextOf(ACCESSORIES, look.accessory) })),
    toggleQuiet: async () => {
      await toggleQuiet($)
    },
    toggleBand: async () => {
      await toggleBand($)
    },
    close: () => $.ui.close({ id: PANE }),
  }
}

/** Opens the pane; resolves why it could not be seated (too narrow, no surface places panes), or nothing. */
async function openPane($: Dollar): Promise<string | undefined> {
  const look = await read($, lookA)
  const opened = await $.ui.open({ id: PANE, title: look.name })
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
        : `Merhaba, ben ${look.name}! Panelimi /nokta ile açabilirsin; /nokta yardım komutları gösterir.`,
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
  const [savedLook, savedPrefs, savedJobs, seen, surfaces] = await Promise.all([
    $.store.get('look'),
    $.store.get('prefs'),
    $.store.get('jobs'),
    $.store.get('seen'),
    $.session.surfaces(),
  ])
  const look = normalizeLook(isRecord(savedLook) ? (savedLook as Partial<NoktaLook>) : undefined)
  await update($, lookA, () => look)
  if (isRecord(savedPrefs)) {
    await update($, bandHiddenA, () => savedPrefs['isBandHidden'] === true)
    await update($, quietA, () => savedPrefs['isQuiet'] === true)
  }
  if ((await read($, jobsA)).length === 0) {
    await update($, jobsA, () => readJobs(savedJobs))
  }
  await touch($)

  const term = (await $.env.get('TERM')) ?? ''
  const program = (await $.env.get('TERM_PROGRAM')) ?? ''
  const kittyWindow = (await $.env.get('KITTY_WINDOW_ID')) ?? ''
  isKitty = kittyWindow !== '' || /kitty|ghostty/i.test(term) || /ghostty|wezterm/i.test(program)

  await $.command.register({
    name: 'nokta',
    description: `${look.name}: durumu, görünümü ve işleri (panel, ad, gövde, renk, sessiz)`,
    argumentHint: '[durum|ad|gövde|renk|aksesuar|sessiz|bant|yardım]',
  })

  await showMood($, 'neutral', '')

  // A person may be at a terminal, or in an app that attaches to the session; either way the
  // engine's `surfaces()` says where Nokta is seen. (An app that attaches later gets `welcome` then.)
  const first = surfaces.find(one => one === 'terminal' || one === 'desktop') ?? surfaces[0] ?? null
  if (isInteractive || first !== null) await welcome($, first)

  $.clock.every(BLINK_EVERY_MS, () => {
    void safe(() => blink($))
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

/** Now and then, in the terminal pane, the sleeping face for a moment: a blink. */
async function blink($: Dollar): Promise<void> {
  if (opt.isKittyWanted && isKitty) return // that pane holds a real image, not cells
  if ((await read($, moodA)) !== 'neutral') return
  if (!(await $.session.surfaces()).includes('terminal')) return
  const panes = await $.ui.panes()
  if (!panes.some(pane => pane.id === PANE && pane.isShown && pane.isPlaced)) return
  const look = await read($, lookA)
  const [closed, open] = await Promise.all([loadCells($, look, 'sleep'), loadCells($, look, 'neutral')])
  if (closed === undefined || open === undefined) return
  const paint = (art: { cells: string; columns: number; rows: number }): Promise<unknown> =>
    $.ui.blit({ requestId: PANE, key: 'nokta-avatar', cells: art.cells, columns: art.columns, rows: art.rows })
  blinks += 1
  const isDouble = blinks % 3 === 0
  await paint(closed)
  $.clock.after(BLINK_MS, () => {
    void safe(async () => {
      // if the mood moved meanwhile, the redraw has painted the new face already
      if ((await read($, moodA)) !== 'neutral') return
      await paint(open)
      if (isDouble) {
        $.clock.after(BLINK_MS, () => {
          void safe(async () => {
            if ((await read($, moodA)) !== 'neutral') return
            await paint(closed)
            $.clock.after(BLINK_MS, () => {
              void safe(async () => {
                if ((await read($, moodA)) === 'neutral') await paint(open)
              })
            })
          })
        })
      }
    })
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
  tickMs = (await $.session.surfaces()).includes('terminal') ? 1000 : 4000
  tick?.cancel()
  tick = $.clock.every(tickMs, () => {
    $.ui.invalidate('ui.render')
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

  // A dialog is about to ask the person: Nokta raises a hand. (The engine's verdict "ask" is not the
  // signal: a mode that approves for itself settles it without anyone being asked. Nothing tells us
  // when they answer; the hand comes down when the call returns.)
  on('classic.PermissionRequest', async ($, e, next) => {
    await safe(() => raiseHand($, e.tool_name, isRecord(e.tool_input) ? e.tool_input : {}))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!opt.isPersona) return composed
    const look = await read($, lookA)
    return {
      sections: [
        ...composed.sections,
        { id: 'nokta:persona', text: personaText(look.name), scope: 'session' as const },
      ],
    }
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
      await saveLook(
        $,
        normalizeLook({ name: look.name, body, color: body === 'nokta' ? 'clay' : DEFAULT_COLOR[body], accessory: 'none' }),
      )
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
    if (sub === 'bant' || sub === 'band') {
      const isHidden = await toggleBand($)
      return { text: isHidden ? 'Bant ve durum satırı gizlendi.' : 'Bant ve durum satırı açık.' }
    }
    return { text: HELP }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const U = $.ui.resolve(e)
    const { Text } = U
    const [look, mood, detail, steps, todos, jobs, isQuiet, isBandHidden] = await Promise.all([
      read($, lookA),
      read($, moodA),
      read($, detailA),
      read($, stepsA),
      read($, todosA),
      read($, jobsA),
      read($, quietA),
      read($, bandHiddenA),
    ])
    const now = await $.clock.now()
    const run = jobs[0]?.status === 'run' ? jobs[0] : undefined
    const rows = e.props.scroll.bodyRows
    // a short room (an inline pane, a small window) gets a line of text instead of the big picture
    const isCompact = e.surface === 'terminal' ? rows < 28 : rows < 14
    const avatar = isCompact ? undefined : await avatarFor($, U, e.surface, look, mood, 'pane')
    return paneBody(
      U,
      {
        look,
        mood,
        detail,
        steps,
        todos,
        jobs,
        elapsed: run === undefined ? 0 : Math.max(0, (now - run.startedAt) / 1000),
        columns: e.props.bodyColumns,
        rows,
        isCompact,
        isQuiet,
        isBandHidden,
        isTerminal: e.surface === 'terminal',
      },
      actions($),
      avatar ?? <Text>{MOOD[mood].face}</Text>,
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (opt.band === 'kapali' || e.props.hasSurvey) return next(e)
    const [mood, isHidden] = await Promise.all([read($, moodA), read($, bandHiddenA)])
    if (isHidden) return next(e)
    if (opt.band === 'etkinken' && !e.props.isWorking && mood !== 'ask' && mood !== 'approve' && mood !== 'worry') {
      return next(e)
    }
    const U = $.ui.resolve(e)
    const [look, detail] = await Promise.all([read($, lookA), read($, detailA)])
    const face = await avatarFor($, U, e.surface, look, mood, 'band')
    return bandRow(U, { look, mood, detail, columns: e.props.bodyColumns }, face, async () => {
      await openPane($)
    })
  })

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
