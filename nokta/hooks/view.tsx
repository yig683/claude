// Nokta's trees: the pane's body and the band above the prompt. Plain data in, elements out;
// the picture (a Raster, an Image or an Svg) comes in drawn, since only the hook knows the surface.
import type { Elements } from 'claude-code'

import type { NoktaJob, NoktaLook, NoktaMood, NoktaStep, NoktaTodo } from '../types'
import { ACCESSORY_LABEL, BODY_LABEL, clip, COLOR_LABEL, fmtDuration, groupSteps, MOOD } from './model'

/** The elements every surface draws. */
export type Common = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type PaneData = {
  look: NoktaLook
  mood: NoktaMood
  detail: string
  steps: readonly NoktaStep[]
  todos: readonly NoktaTodo[]
  jobs: readonly NoktaJob[]
  /** What Nokta remembers, newest last. */
  notes: readonly string[]
  /** Seconds the running turn has taken; 0 when none runs. */
  elapsed: number
  /** Cells across the body and rows the pane may take. */
  columns: number
  rows: number
  /** A short room (an inline pane, a small window): no big picture, fewer lines. */
  isCompact: boolean
  isQuiet: boolean
  isStill: boolean
  isBandHidden: boolean
  isTerminal: boolean
  isMemory: boolean
}

export type PaneActions = {
  cycleBody: () => Promise<void>
  cycleColor: () => Promise<void>
  cycleAccessory: () => Promise<void>
  toggleQuiet: () => Promise<void>
  toggleStill: () => Promise<void>
  toggleBand: () => Promise<void>
  close: () => Promise<void>
  pet: () => Promise<void>
  forget: (index: number) => Promise<void>
}

const STEP_GLYPH = { run: '●', ok: '✓', err: '✗' } as const
const STEP_COLOR = { run: 'claude', ok: 'success', err: 'error' } as const
const TODO_GLYPH = { pending: '☐', in_progress: '◐', completed: '☑' } as const
const JOB_GLYPH = { run: '●', ok: '✓', err: '✗', stop: '■' } as const
const JOB_COLOR = { run: 'claude', ok: 'success', err: 'error', stop: 'warning' } as const

/** A section's small label, in capitals (the terminal's own text cannot be set smaller). */
function Heading(U: Common, text: string, extra?: string): JSX.Element {
  const { Box, Text } = U
  return (
    <Box flexDirection="row" gap={1}>
      <Text bold dimColor>
        {text.toLocaleUpperCase('tr')}
      </Text>
      {extra !== undefined && <Text dimColor>{extra}</Text>}
    </Box>
  )
}

/** A button: the terminal's `[ label ]` with its hotkey; elsewhere the surface's own native button. */
function Btn(
  U: Common,
  isTerminal: boolean,
  o: { key: string; label: string; onPress: () => Promise<void>; hotkey?: string; isDim?: boolean; isPrimary?: boolean },
): JSX.Element {
  const { Button } = U
  return isTerminal ? (
    <Button key={o.key} plain hotkey={o.hotkey} dimColor={o.isDim} label={o.label} onPress={o.onPress} />
  ) : (
    <Button
      key={o.key}
      variant={o.isPrimary === true ? 'primary' : undefined}
      dimColor={o.isDim}
      label={o.label}
      onPress={o.onPress}
    />
  )
}

/** The one line under the name: how long the turn runs, or how the last one went. */
export function statsLine(d: Pick<PaneData, 'mood' | 'elapsed' | 'jobs'>): string {
  const job = d.jobs[0]
  if (d.mood === 'sleep') return 'Dinleniyor. Bir şey yazınca uyanır.'
  if (job === undefined) return 'Henüz iş yok. Bir şey iste, başlayalım.'
  if (job.status === 'run') {
    return `${fmtDuration(d.elapsed)} · ${job.tools} araç`
  }
  return `Son iş: ${fmtDuration(job.seconds)} · ${job.tools} araç`
}

export function paneBody(U: Common, d: PaneData, a: PaneActions, avatar: JSX.Element): JSX.Element {
  const { Box, Text } = U
  const m = MOOD[d.mood]
  const tint = d.isTerminal ? m.color : m.ui
  const isHero = !d.isTerminal && !d.isCompact // the apps get one drawn picture on top, centred
  // beside the picture on a wide terminal; everywhere else the picture sits on top, centred
  const isSideBySide = d.isTerminal && !d.isCompact && d.columns >= 56
  const room = d.isCompact ? 3 : Math.max(3, Math.min(8, d.rows - 24))
  const steps = groupSteps(d.steps).slice(-room)
  const todos = d.todos.slice(0, d.isCompact ? 3 : 6)
  const jobs = d.jobs.slice(0, d.isCompact ? 2 : 5)
  const notes = d.notes.slice(-(d.isCompact ? 2 : 5))
  const firstNote = d.notes.length - notes.length
  const titleWidth = Math.max(16, d.columns - 22)
  const detail =
    d.detail === '' || d.mood === 'neutral' || d.mood === 'sleep' ? '' : clip(d.detail, Math.max(12, d.columns - 8))

  // who this is and what it is doing: the name, a coloured state, the step, the time
  const identity = (
    <Box flexDirection="column" flexGrow={isSideBySide ? 1 : 0} alignItems={isSideBySide ? 'flex-start' : 'center'}>
      <Box flexDirection="row" gap={1}>
        <Text bold>{d.look.name}</Text>
        <Text color={tint} bold>
          {d.isTerminal ? `${m.face} ` : '● '}
          {m.label}
        </Text>
      </Box>
      {detail !== '' && (
        <Text dimColor wrap="truncate-end">
          {detail}
        </Text>
      )}
      <Text dimColor wrap="truncate-end">
        {statsLine(d)}
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {d.isCompact ? (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={tint} bold>
              {m.face}
            </Text>
            <Text bold>{d.look.name}</Text>
            <Text color={tint}>{m.label}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {statsLine(d)}
          </Text>
        </Box>
      ) : isHero ? (
        <Box flexDirection="column" alignItems="center" gap={1}>
          {avatar}
          {identity}
          {Btn(U, false, { key: 'pet', label: "♡ Nokta'yı sev", onPress: a.pet })}
        </Box>
      ) : isSideBySide ? (
        <Box flexDirection="row" gap={2} alignItems="center">
          {avatar}
          {identity}
        </Box>
      ) : (
        <Box flexDirection="column" alignItems="center">
          {avatar}
          {identity}
          {Btn(U, true, { key: 'pet', label: "♡ Nokta'yı sev", onPress: a.pet, hotkey: 'v' })}
        </Box>
      )}

      <Box flexDirection="column">
        {Heading(U, 'Şu an')}
        {steps.length === 0 && <Text dimColor>Henüz bir şey yapmadı.</Text>}
        {steps.map(step => (
          <Box flexDirection="row" gap={1}>
            <Text color={STEP_COLOR[step.status]}>{STEP_GLYPH[step.status]}</Text>
            <Text wrap="truncate-end" dimColor={step.status === 'ok'}>
              {clip(step.label, Math.max(12, d.columns - 10))}
            </Text>
            {step.count > 1 && <Text dimColor>×{step.count}</Text>}
          </Box>
        ))}
      </Box>

      {todos.length > 0 && (
        <Box flexDirection="column">
          {Heading(U, 'Görevler')}
          {todos.map(todo => (
            <Box flexDirection="row" gap={1}>
              <Text color={todo.status === 'completed' ? 'success' : todo.status === 'in_progress' ? 'claude' : 'inactive'}>
                {TODO_GLYPH[todo.status]}
              </Text>
              <Text wrap="truncate-end" dimColor={todo.status === 'completed'} strikethrough={todo.status === 'completed'}>
                {clip(todo.text, Math.max(12, d.columns - 4))}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {d.isMemory && (
        <Box flexDirection="column">
          {Heading(U, 'Hafıza', d.notes.length === 0 ? undefined : `${d.notes.length} not`)}
          {notes.length === 0 && (
            <Text dimColor wrap="wrap">
              Henüz bir şey hatırlamıyorum. Söyle ya da yaz: /nokta hatırla hep Türkçe yaz
            </Text>
          )}
          {notes.map((note, i) => (
            <Box flexDirection="row" gap={1}>
              <Text color="claude">•</Text>
              <Text wrap="truncate-end">{clip(note, Math.max(12, d.columns - 10))}</Text>
              <Box flexGrow={1} />
              {Btn(U, true, { key: `forget-${firstNote + i}`, label: '×', onPress: () => a.forget(firstNote + i), isDim: true })}
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="column">
        {Heading(U, 'Son işler')}
        {jobs.length === 0 && <Text dimColor>İş geçmişi boş.</Text>}
        {jobs.map(job => (
          <Box flexDirection="row" gap={1}>
            <Text color={JOB_COLOR[job.status]}>{JOB_GLYPH[job.status]}</Text>
            <Text wrap="truncate-end">{clip(job.title, titleWidth)}</Text>
            <Text dimColor>
              {job.status === 'run' ? 'sürüyor' : `${fmtDuration(job.seconds)} · ${job.tools} araç`}
            </Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" gap={d.isTerminal ? 0 : 1}>
        {Heading(U, 'Görünüm')}
        <Box flexDirection="row" flexWrap="wrap" columnGap={d.isTerminal ? 2 : 1} rowGap={d.isTerminal ? 0 : 1}>
          {Btn(U, d.isTerminal, {
            key: 'body',
            label: `Gövde: ${BODY_LABEL[d.look.body]}${d.isTerminal ? ' ▸' : ''}`,
            onPress: a.cycleBody,
            hotkey: 'g',
          })}
          {d.look.body === 'nokta' ? (
            Btn(U, d.isTerminal, {
              key: 'color',
              label: `Renk: ${COLOR_LABEL[d.look.color]}${d.isTerminal ? ' ▸' : ''}`,
              onPress: a.cycleColor,
              hotkey: 'r',
            })
          ) : (
            <Text dimColor>Renk: {COLOR_LABEL[d.look.color]} (sabit)</Text>
          )}
          {d.look.body === 'nokta' ? (
            Btn(U, d.isTerminal, {
              key: 'accessory',
              label: `Aksesuar: ${ACCESSORY_LABEL[d.look.accessory]}${d.isTerminal ? ' ▸' : ''}`,
              onPress: a.cycleAccessory,
              hotkey: 'a',
            })
          ) : (
            <Text dimColor>Aksesuar: yok (sabit)</Text>
          )}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={d.isTerminal ? 2 : 1} rowGap={d.isTerminal ? 0 : 1}>
          {Btn(U, d.isTerminal, {
            key: 'motion',
            label: `Hareket: ${d.isStill ? 'kapalı' : 'açık'}`,
            onPress: a.toggleStill,
            hotkey: 'h',
          })}
          {Btn(U, d.isTerminal, {
            key: 'quiet',
            label: `Sessiz: ${d.isQuiet ? 'açık' : 'kapalı'}`,
            onPress: a.toggleQuiet,
            hotkey: 's',
          })}
          {Btn(U, d.isTerminal, {
            key: 'band',
            label: `Bant: ${d.isBandHidden ? 'gizli' : 'açık'}`,
            onPress: a.toggleBand,
            hotkey: 'b',
          })}
          {isSideBySide && Btn(U, true, { key: 'pet', label: '♡ Sev', onPress: a.pet, hotkey: 'v' })}
          {Btn(U, d.isTerminal, { key: 'close', label: 'Kapat', onPress: a.close, hotkey: 'k', isDim: true })}
        </Box>
      </Box>
    </Box>
  )
}

export type BandData = {
  look: NoktaLook
  mood: NoktaMood
  detail: string
  /** Seconds the running turn has taken; 0 when none runs. */
  elapsed: number
  tools: number
  /** What to say when nothing is going on (how the last job went, or that it rests). */
  note: string
  columns: number
  isTerminal: boolean
}

/** The band above the prompt: one slim line, the picture (where the surface draws one) at its left. */
export function bandRow(
  U: Common,
  d: BandData,
  face: JSX.Element | undefined,
  onPanel: () => Promise<void>,
): JSX.Element {
  const { Box, Text, Button } = U
  const m = MOOD[d.mood]
  const tint = d.isTerminal ? m.color : m.ui
  const isBusy = d.mood === 'work' || d.mood === 'ask' || d.mood === 'approve'
  const room = Math.max(10, d.columns - (face === undefined ? 36 : 40))
  const doing = d.detail === '' || d.mood === 'neutral' || d.mood === 'sleep' ? '' : d.detail
  const timing = isBusy && d.elapsed > 0 ? `${fmtDuration(d.elapsed)} · ${d.tools} araç` : ''
  const line = clip([doing, timing].filter(part => part !== '').join(' · ') || d.note, room)
  return (
    <Box flexDirection="row" gap={1} alignItems="center">
      {face ?? (
        <Text color={tint} bold>
          {m.face}
        </Text>
      )}
      <Text bold>{d.look.name}</Text>
      <Text color={tint} bold>
        {m.label}
      </Text>
      {d.columns >= 56 && (
        <Text dimColor wrap="truncate-end">
          · {line}
        </Text>
      )}
      <Box flexGrow={1} />
      <Button key="panel" plain dimColor label="panel" onPress={onPanel} />
    </Box>
  )
}
