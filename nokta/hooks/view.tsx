// Nokta's trees: the pane's body and the band above the prompt. Plain data in, elements out;
// the picture (a Raster, an Image or an Svg) comes in drawn, since only the hook knows the surface.
import type { Elements } from 'claude-code'

import type { NoktaJob, NoktaLook, NoktaMood, NoktaStep, NoktaTodo } from '../types'
import { ACCESSORY_LABEL, BODY_LABEL, clip, COLOR_LABEL, fmtDuration, MOOD } from './model'

/** The elements every surface draws. */
export type Common = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type PaneData = {
  look: NoktaLook
  mood: NoktaMood
  detail: string
  steps: readonly NoktaStep[]
  todos: readonly NoktaTodo[]
  jobs: readonly NoktaJob[]
  /** Seconds the running turn has taken; 0 when none runs. */
  elapsed: number
  /** Cells across the body and rows the pane may take. */
  columns: number
  rows: number
  /** A short room (an inline pane, a small window): no big picture, fewer lines. */
  isCompact: boolean
  isQuiet: boolean
  isBandHidden: boolean
  isTerminal: boolean
}

export type PaneActions = {
  cycleBody: () => Promise<void>
  cycleColor: () => Promise<void>
  cycleAccessory: () => Promise<void>
  toggleQuiet: () => Promise<void>
  toggleBand: () => Promise<void>
  close: () => Promise<void>
}

const STEP_GLYPH = { run: '●', ok: '✓', err: '✗' } as const
const STEP_COLOR = { run: 'claude', ok: 'success', err: 'error' } as const
const TODO_GLYPH = { pending: '☐', in_progress: '◐', completed: '☑' } as const
const JOB_GLYPH = { run: '●', ok: '✓', err: '✗', stop: '■' } as const
const JOB_COLOR = { run: 'claude', ok: 'success', err: 'error', stop: 'warning' } as const

function Heading(U: Common, text: string): JSX.Element {
  const { Text } = U
  return (
    <Text bold dimColor>
      {text}
    </Text>
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
  const { Box, Text, Button } = U
  const m = MOOD[d.mood]
  const isWide = !d.isCompact && d.columns >= 56
  const room = d.isCompact ? 3 : Math.max(3, Math.min(8, d.rows - 24))
  const steps = d.steps.slice(-room)
  const todos = d.todos.slice(0, d.isCompact ? 3 : 6)
  const jobs = d.jobs.slice(0, d.isCompact ? 2 : 5)
  const titleWidth = Math.max(16, d.columns - 22)

  const identity = (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold>{d.look.name}</Text>
      <Text color={m.color} bold>
        {m.face} {m.label}
      </Text>
      <Text dimColor wrap="truncate-end">
        {d.detail === '' || d.mood === 'neutral' || d.mood === 'sleep' ? ' ' : clip(d.detail, Math.max(12, d.columns - 28))}
      </Text>
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
            <Text color={m.color} bold>
              {m.face}
            </Text>
            <Text bold>{d.look.name}</Text>
            <Text color={m.color}>{m.label}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {statsLine(d)}
          </Text>
        </Box>
      ) : isWide ? (
        <Box flexDirection="row" gap={2} alignItems="center">
          {avatar}
          {identity}
        </Box>
      ) : (
        <Box flexDirection="column" alignItems="center">
          {avatar}
          {identity}
        </Box>
      )}

      <Box flexDirection="column">
        {Heading(U, 'Şu an')}
        {steps.length === 0 && <Text dimColor>Henüz bir şey yapmadı.</Text>}
        {steps.map(step => (
          <Box flexDirection="row" gap={1}>
            <Text color={STEP_COLOR[step.status]}>{STEP_GLYPH[step.status]}</Text>
            <Text wrap="truncate-end" dimColor={step.status === 'ok'}>
              {clip(step.label, Math.max(12, d.columns - 4))}
            </Text>
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

      <Box flexDirection="column">
        {Heading(U, 'Görünüm')}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Button
            key="body"
            plain
            hotkey="g"
            label={`Gövde: ${BODY_LABEL[d.look.body]} ▸`}
            onPress={a.cycleBody}
          />
          {d.look.body === 'nokta' ? (
            <Button
              key="color"
              plain
              hotkey="r"
              label={`Renk: ${COLOR_LABEL[d.look.color]} ▸`}
              onPress={a.cycleColor}
            />
          ) : (
            <Text dimColor>Renk: {COLOR_LABEL[d.look.color]} (sabit)</Text>
          )}
          {d.look.body === 'nokta' ? (
            <Button
              key="accessory"
              plain
              hotkey="a"
              label={`Aksesuar: ${ACCESSORY_LABEL[d.look.accessory]} ▸`}
              onPress={a.cycleAccessory}
            />
          ) : (
            <Text dimColor>Aksesuar: yok (sabit)</Text>
          )}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Button
            key="quiet"
            plain
            hotkey="s"
            label={`Sessiz: ${d.isQuiet ? 'açık' : 'kapalı'}`}
            onPress={a.toggleQuiet}
          />
          <Button
            key="band"
            plain
            hotkey="b"
            label={`Bant: ${d.isBandHidden ? 'gizli' : 'açık'}`}
            onPress={a.toggleBand}
          />
          <Button key="close" plain hotkey="k" dimColor label="Kapat" onPress={a.close} />
        </Box>
      </Box>
    </Box>
  )
}

export type BandData = {
  look: NoktaLook
  mood: NoktaMood
  detail: string
  columns: number
}

export function bandRow(
  U: Common,
  d: BandData,
  face: JSX.Element | undefined,
  onPanel: () => Promise<void>,
): JSX.Element {
  const { Box, Text, Button } = U
  const m = MOOD[d.mood]
  const isNarrow = d.columns < 64
  const detail =
    d.detail === '' || d.mood === 'neutral' || d.mood === 'sleep'
      ? ''
      : clip(d.detail, Math.max(10, d.columns - 36))
  return (
    <Box flexDirection="row" gap={1} alignItems="center">
      {face ?? (
        <Text color={m.color} bold>
          {m.face}
        </Text>
      )}
      <Text bold>{d.look.name}</Text>
      <Text color={m.color}>{m.label}</Text>
      {!isNarrow && detail !== '' && (
        <Text dimColor wrap="truncate-end">
          · {detail}
        </Text>
      )}
      <Box flexGrow={1} />
      <Button key="panel" plain dimColor label="panel" onPress={onPanel} />
    </Box>
  )
}
