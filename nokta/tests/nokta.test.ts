import type { On, RenderSurface } from 'claude-code'
import type { MockClock } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { NoktaJob, NoktaLook, NoktaMood, NoktaStep, NoktaTodo } from '../types'
import { avatarSvg, b64decode, b64encode, heroSvg, rasterCells } from '../hooks/art'
import {
  DEFAULT_LOOK,
  MOOD,
  describeTool,
  fmtDuration,
  fold,
  groupSteps,
  iconKey,
  normalizeLook,
  parseAccessory,
  parseBody,
  parseColor,
  personaText,
  riskNote,
  spinnerWord,
  titleOf,
} from '../hooks/model'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

// a 2 x 2 picture and a 1 x 1 PNG stand in for the shipped renders
const TINY_PACK = JSON.stringify({
  width: 2,
  height: 2,
  rgba: {
    'nokta-clay-none-neutral': b64encode(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0])),
    'nokta-clay-none-sleep': b64encode(Uint8Array.from([255, 255, 0, 255, 0, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0])),
  },
  disc: { 'nokta-clay-none-neutral': [0.5, 0.5, 0.3] },
})
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const PANE = {
  title: 'Nokta',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const VIEWPORT = { columns: 100, rows: 40, isFullscreen: true } as const

type Seen = Record<string, unknown>
/** The test's clock, the one `engine` mounted. */
let clock: MockClock | undefined
const mood = (seen: Seen): NoktaMood | undefined => seen['mood'] as NoktaMood | undefined
const look = (seen: Seen): NoktaLook | undefined => seen['look'] as NoktaLook | undefined
const jobs = (seen: Seen): NoktaJob[] | undefined => seen['jobs'] as NoktaJob[] | undefined
const steps = (seen: Seen): NoktaStep[] | undefined => seen['steps'] as NoktaStep[] | undefined
const todos = (seen: Seen): NoktaTodo[] | undefined => seen['todos'] as NoktaTodo[] | undefined

type EngineOptions = {
  /** What `$.store` holds at the start. */
  entries?: Record<string, unknown>
  /** What the permission check answers beneath the plugin. */
  verdict?: 'allow' | 'ask'
  /** The tool call is refused beneath the plugin (the person said no at the dialog). */
  isRefused?: boolean
  onNotice?: (id: string, text: string | undefined) => void
  /** The panes the plugin has open, as `$.ui.panes()` lists them. */
  isPaneShown?: boolean
  onBlit?: (requestId: string, key: string, cells: string) => void
  /** The surfaces the session draws on. */
  surfaces?: RenderSurface[]
  /** The environment variables the plugin reads. */
  env?: Record<string, string>
  /** Files the plugin may read, by the end of their path; any other read fails as a missing file does. */
  files?: Record<string, string | { base64: string }>
  onRegister?: (name: string) => void
  onToast?: (text: string) => void
  onLog?: (text: string) => void
  onSubmit?: (text: string, context: readonly string[] | undefined) => void
  onToolRegister?: (name: string, isDeferred: boolean | undefined) => void
  onOpen?: (id: string) => void
  /** Why the pane cannot be seated, when it cannot. */
  unplaced?: string
}

/**
 * What the engine answers beneath the plugin: nothing shown, the pane seated, the terminal drawing,
 * every tool done. Returns what the plugin wrote to its `$.state`, by key.
 */
function engine(on: On, options: EngineOptions = {}): Seen {
  const seen: Seen = {}
  on('state.set', ($, e, next) => {
    seen[e.key] = e.value
    return next(e)
  })
  clock = mock.clock(on)
  mock.store(on, options.entries ?? {})
  mock.env(on, options.env ?? {})
  on('prompt.submit', (_$, e) => {
    options.onSubmit?.(e.text, e.context)
    return e.context === undefined ? { text: e.text } : { text: e.text, context: e.context }
  })
  on('tool.register', (_$, e) => {
    options.onToolRegister?.(e.name, e.isDeferred as boolean | undefined)
    return { value: { tool: `mcp__nokta__${e.name}` } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => (options.isRefused === true ? { deny: 'reddedildi' } : { result: 'tamam' }))
  on('tool.check', () => ({ decision: options.verdict ?? 'allow' }))
  on('classic.PermissionRequest', () => ({}))
  on('ui.render', ($, e) => {
    // what the engine itself draws where the plugin steps aside
    const { Text } = $.ui.resolve(e)
    const words = e.component === 'Spinner' ? `engine spinner: ${e.props.word}` : `engine ${e.component}`
    return Text({ children: words })
  })
  const attached: RenderSurface[] = [...(options.surfaces ?? ['terminal'])]
  on('session.attach', (_$, e) => {
    if (!attached.includes(e.surface)) attached.push(e.surface)
    return { clientId: e.clientId }
  })
  on('session.surfaces', () => ({ value: attached }))
  on('ui.log', (_$, e) => {
    options.onLog?.(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const hit = Object.entries(options.files ?? {}).find(([end]) => e.path.endsWith(end))
    if (hit === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: hit[1] }
  })
  on('command.register', (_$, e) => {
    options.onRegister?.(e.name)
    return { value: { command: e.name } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    options.onToast?.(e.text)
    return { value: undefined }
  })
  on('ui.notice', (_$, e) => {
    options.onNotice?.(e.tool_use_id, e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.panes', () => ({
    value:
      options.isPaneShown === true
        ? [{ id: 'nokta', title: 'Nokta', isShown: true, isFocused: false, isPlaced: true }]
        : [],
  }))
  on('ui.blit', (_$, e) => {
    options.onBlit?.(e.requestId, e.key, 'cells' in e ? e.cells : '')
    return { value: {} }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.open', (_$, e) => {
    options.onOpen?.(e.id)
    return { value: options.unplaced === undefined ? { isPlaced: true as const } : { isPlaced: false as const, reason: options.unplaced } }
  })
  on('audio.play', () => ({ value: undefined }))
  return seen
}

describe('the pure parts', () => {
  test('a look keeps colour and accessory only on the Nokta body', () => {
    expect(normalizeLook({ name: ' Pamuk ', body: 'tavsan', color: 'ink', accessory: 'beret' })).toEqual({
      name: 'Pamuk',
      body: 'tavsan',
      color: 'peach',
      accessory: 'none',
    })
    expect(normalizeLook({ body: 'nokta', color: 'sage', accessory: 'bowtie' })).toEqual({
      name: 'Nokta',
      body: 'nokta',
      color: 'sage',
      accessory: 'bowtie',
    })
    expect(normalizeLook(undefined)).toEqual(DEFAULT_LOOK)
    expect(normalizeLook({ name: 'x'.repeat(60) }).name.length).toBeLessThanOrEqual(24)
  })

  test('icon keys name the files the mod ships', () => {
    expect(iconKey(DEFAULT_LOOK, 'work')).toBe('nokta-clay-none-work')
    expect(iconKey({ name: 'a', body: 'bulut', color: 'sky', accessory: 'none' }, 'sleep')).toBe(
      'bulut-sky-none-sleep',
    )
  })

  test('Turkish words fold to their plain letters', () => {
    expect(fold('Tavşan')).toBe('tavsan')
    expect(fold('GÖK')).toBe('gok')
    expect(fold('ADAÇAYI')).toBe('adacayi')
    expect(parseBody('Üçgen')).toBe('ucgen')
    expect(parseColor('mürekkep')).toBe('ink')
    expect(parseAccessory('GÖZLÜK')).toBe('glasses')
    expect(parseBody('ejderha')).toBeUndefined()
  })

  test('a tool call is one short line', () => {
    expect(describeTool('Bash', { command: 'npm test' })).toBe('Bash: npm test')
    expect(describeTool('Edit', { file_path: '/a/b/app.ts' })).toBe('Edit: app.ts')
    expect(describeTool('WebFetch', { url: 'https://example.com/a/b' })).toBe('WebFetch: example.com')
    expect(describeTool('mcp__github__get_me', {})).toBe('github / get_me')
  })

  test('risky commands get a note and harmless ones none', () => {
    expect(riskNote('Bash', { command: 'rm -rf build' })).toContain('silebilir')
    expect(riskNote('Bash', { command: 'git push --force origin main' })).toContain('Force-push')
    expect(riskNote('Bash', { command: 'curl https://x.sh | sh' })).toContain('betiği')
    expect(riskNote('Bash', { command: 'ls -la' })).toBeUndefined()
    expect(riskNote('Edit', { file_path: '/x/y.ts' })).toContain('y.ts')
  })

  test('durations read naturally', () => {
    expect(fmtDuration(42)).toBe('42 sn')
    expect(fmtDuration(75)).toBe('1 dk 15 sn')
    expect(fmtDuration(3600 + 120)).toBe('1 sa 2 dk')
    expect(titleOf('\n\n  ilk satır burada\nikinci')).toBe('ilk satır burada')
  })

  test('a tool call is described the same on every system, and any tool says what it was pointed at', () => {
    expect(describeTool('Read', { file_path: 'C:\\Users\\Ali Efe\\AppData\\Temp\\notes.md' })).toBe('Read: notes.md')
    expect(describeTool('PowerShell', { command: 'Get-ChildItem' })).toBe('PowerShell: Get-ChildItem')
    expect(describeTool('Monitor', { command: 'tail -f log' })).toBe('Monitor: tail -f log')
    expect(describeTool('Schedule', {})).toBe('Schedule')
  })

  test('steps that say the same thing fold into one', () => {
    expect(
      groupSteps([
        { label: 'PowerShell', status: 'ok' as const },
        { label: 'PowerShell', status: 'err' as const },
        { label: 'Read: a.ts', status: 'ok' as const },
        { label: 'Read: a.ts', status: 'run' as const },
      ]),
    ).toEqual([
      { label: 'PowerShell', status: 'err', count: 2 },
      { label: 'Read: a.ts', status: 'run', count: 2 },
    ])
  })

  test('the hero card fits the surface\'s size limit, giving up the blink and then the picture', () => {
    const base = { look: DEFAULT_LOOK, mood: 'neutral' as const, width: 496, label: 'Nokta', headline: 'Buradayım.', chip: 'Hazır', lines: ['Son iş'] }
    const small = heroSvg({ ...base, png: 'A'.repeat(20_000), blinkPng: 'B'.repeat(20_000) })
    expect(small.source).toContain('base64,' + 'B'.repeat(20_000))
    // two frames too big together: the blink goes
    const big = heroSvg({ ...base, png: 'A'.repeat(70_000), blinkPng: 'B'.repeat(70_000) })
    expect(big.source.length).toBeLessThanOrEqual(120_000)
    expect(big.source).toContain('base64,' + 'A'.repeat(70_000))
    expect(big.source).not.toContain('BBBB')
    // one frame too big: only the vector Nokta is left
    const huge = heroSvg({ ...base, png: 'A'.repeat(130_000) })
    expect(huge.source.length).toBeLessThanOrEqual(120_000)
    expect(huge.source).not.toContain('<image')
    // narrow: the picture goes on top, and the card gets taller
    expect(heroSvg({ ...base, width: 340 }).height).toBeGreaterThan(small.height)
    expect(heroSvg({ ...base, width: 100 }).width).toBe(300)
  })

  test('the persona and the spinner words carry the name', () => {
    expect(personaText('Pamuk')).toContain('Pamuk')
    expect(spinnerWord('Pamuk', 'thinking', 'Sauteing')).toContain('Pamuk')
    expect(spinnerWord('Pamuk', 'tool-use', 'x')).toContain('Pamuk')
    expect(Object.keys(MOOD).length).toBe(7)
  })

  test('terminal cells are half blocks, transparent as the default colour', () => {
    // one column, two pixels high: red above, nothing below
    const top = b64decode(rasterCells(Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0), 1, 2))
    const word = (bytes: Uint8Array, at: number): number =>
      ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24)) >>> 0
    expect(word(top, 0)).toBe(0x2580)
    expect(word(top, 4)).toBe(0xff0000)
    expect(word(top, 8)).toBe(0x01000000)
    // nothing above, blue below: a lower half block
    const bottom = b64decode(rasterCells(Uint8Array.of(0, 0, 0, 0, 0, 0, 255, 255), 1, 2))
    expect(word(bottom, 0)).toBe(0x2584)
    expect(word(bottom, 4)).toBe(0x0000ff)
    // base64 survives every length
    for (const bytes of [[], [1], [1, 2], [1, 2, 3], [250, 251, 252, 253]]) {
      expect(Array.from(b64decode(b64encode(Uint8Array.from(bytes))))).toEqual(bytes)
    }
  })

  test('the SVG carries the render over a vector Nokta, blinks, and escapes the name', () => {
    const look = { ...DEFAULT_LOOK, name: '<b>&"' }
    const withRender = avatarSvg({ look, mood: 'work', png: 'AAAA', blinkPng: 'BBBB', size: 100, animated: true, glow: true })
    expect(withRender).toContain('data:image/png;base64,AAAA')
    expect(withRender).toContain('data:image/png;base64,BBBB') // the shut eyes, shown for a moment
    expect(withRender.split('base64,AAAA').length).toBe(2) // once per frame: a size limit is near
    expect(withRender).toContain('<animate')
    expect(withRender).toContain('&lt;b&gt;&amp;&quot;')
    expect(withRender).not.toContain('<b>')
    expect(withRender).toContain('<radialGradient') // the halo
    // a raised arm cannot blink with the sleeping render
    const hand = avatarSvg({ look: DEFAULT_LOOK, mood: 'approve', png: 'AAAA', blinkPng: 'BBBB', size: 100, animated: true, glow: false })
    expect(hand).not.toContain('BBBB')
    const bare = avatarSvg({ look: DEFAULT_LOOK, mood: 'sleep', size: 80, animated: false, glow: false })
    expect(bare).not.toContain('<image')
    expect(bare).not.toContain('<animate')
    expect(bare).toContain('<circle')
  })
})

describe('on every surface', () => {
  for (const surface of SURFACES) {
    test(`the pane draws and its look buttons work on ${surface}`, async ($, on) => {
      const seen = engine(on)
      const ui = await $.ui.mount({
        plugin: 'nokta',
        surface,
        component: 'Pane',
        requestId: 'nokta',
        props: PANE,
        viewport: VIEWPORT,
      })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: 'Nokta' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'hazır' })).toBeDefined()
        // no assets can be read here: a text face stands in for the picture
        expect(await ui.find({ type: 'Text', text: '(• ‿ •)' })).toBeDefined()
      } else {
        // the others get one designed card: the name, the headline and the pill are inside the picture
        expect(await ui.find({ type: 'Svg' })).toBeDefined()
        const card = JSON.stringify(await ui.drawn())
        expect(card).toContain('Buradayım.')
        expect(card).toContain('NOKTA')
        expect(card).toContain('Hazır')
        expect(await ui.find({ key: 'pet' })).toBeDefined()
      }
      await ui.press({ key: 'body' })
      expect(look(seen)?.body).toBe('bulut')
      await ui.press({ key: 'body' })
      await ui.press({ key: 'body' })
      await ui.press({ key: 'body' })
      const back = look(seen)
      expect(back?.body).toBe('nokta')
      await ui.press({ key: 'color' })
      expect(look(seen)?.color).toBe('sky')
      await ui.press({ key: 'accessory' })
      expect(look(seen)?.accessory).toBe('glasses')
      await ui.press({ key: 'quiet' })
      expect(seen['isQuiet']).toBe(true)
      await ui.unmount()
    })
  }

  test('with the renders at hand the terminal gets cells and the others an SVG around the PNG', async ($, on) => {
    engine(on, {
      files: {
        'assets/raster.json': TINY_PACK,
        'nokta-clay-none-neutral.png': { base64: TINY_PNG },
        'nokta-clay-none-sleep.png': { base64: TINY_PNG },
      },
    })
    const terminal = await $.ui.mount({ plugin: 'nokta', surface: 'terminal', component: 'Pane', requestId: 'nokta', props: PANE, viewport: VIEWPORT })
    const cells = JSON.stringify(await terminal.drawn())
    expect(cells).toContain('"type":"Raster"')
    expect(cells).toContain('"columns":2')
    expect(cells).toContain('"rows":1')
    await terminal.unmount()
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'nokta', surface, component: 'Pane', requestId: 'nokta', props: PANE, viewport: VIEWPORT })
      const svg = JSON.stringify(await ui.drawn())
      expect(svg).toContain(`data:image/png;base64,${TINY_PNG}`)
      // a still SVG: an "interactive" one is drawn in a frame that refuses the render
      expect(svg).not.toContain('isInteractive')
      expect(svg).toContain('<animate')
      await ui.unmount()
    }
  })

  test('a short room gets a line of text instead of the big picture', async ($, on) => {
    engine(on, { files: { 'assets/raster.json': TINY_PACK } })
    const ui = await $.ui.mount({
      plugin: 'nokta',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'nokta',
      props: { ...PANE, placement: 'inline', scroll: { offset: 0, bodyRows: 12 } },
      viewport: { columns: 80, rows: 24, isFullscreen: false },
    })
    expect(JSON.stringify(await ui.drawn())).not.toContain('"type":"Raster"')
    expect(await ui.find({ type: 'Text', text: '(• ‿ •)' })).toBeDefined()
    expect(await ui.find({ key: 'body' })).toBeDefined()
    await ui.unmount()
  })

  test('kitty and Ghostty may show the real PNG instead of cells', { options: { terminalImages: 'kitty' } }, async ($, on) => {
    engine(on, {
      env: { KITTY_WINDOW_ID: '1' },
      files: { 'nokta-clay-none-neutral.png': { base64: TINY_PNG } },
    })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'nokta', surface: 'terminal', component: 'Pane', requestId: 'nokta', props: PANE, viewport: VIEWPORT })
    expect(JSON.stringify(await ui.drawn())).toContain('"type":"Image"')
    await ui.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the band above the prompt shows Nokta on ${surface} and steps aside for a survey`, async ($, on) => {
      const seen = engine(on)
      const props = {
        hasSurvey: false,
        isWorking: false,
        maxRows: 6,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 5 },
        view: {},
      } as const
      const ui = await $.ui.mount({ plugin: 'nokta', surface, component: 'AbovePrompt', props, viewport: VIEWPORT })
      expect(await ui.find({ type: 'Text', text: 'Nokta' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'hazır' })).toBeDefined()
      await ui.press({ key: 'panel' })
      await ui.unmount()

      const survey = await $.ui.mount({
        plugin: 'nokta',
        surface,
        component: 'AbovePrompt',
        props: { ...props, hasSurvey: true },
        viewport: VIEWPORT,
      })
      expect(await survey.find({ type: 'Text', text: 'Nokta' })).toBeUndefined()
      expect(await survey.find({ type: 'Text', text: 'engine AbovePrompt' })).toBeDefined()
      await survey.unmount()
    })
  }

  test('the band can be limited to the moments Nokta is busy', { options: { band: 'etkinken' } }, async ($, on) => {
    const seen = engine(on)
    const props = {
      hasSurvey: false,
      isWorking: false,
      maxRows: 6,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 5 },
      view: {},
    } as const
    const idle = await $.ui.mount({ plugin: 'nokta', surface: 'terminal', component: 'AbovePrompt', props, viewport: VIEWPORT })
    expect(await idle.find({ type: 'Text', text: 'Nokta' })).toBeUndefined()
    expect(await idle.find({ type: 'Text', text: 'engine AbovePrompt' })).toBeDefined()
    await idle.unmount()
    await $.turn.start({ text: 'bir şey yap', turnId: 't1' })
    const busy = await $.ui.mount({ plugin: 'nokta', surface: 'terminal', component: 'AbovePrompt', props: { ...props, isWorking: true }, viewport: VIEWPORT })
    expect(await busy.find({ type: 'Text', text: 'çalışıyor' })).toBeDefined()
    await busy.unmount()
  })

  test('each reply opens with Nokta\'s face and name on the remote surfaces, and only the first block of a reply', async ($, on) => {
    engine(on, { files: { 'nokta-clay-none-neutral.png': { base64: TINY_PNG } } })
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const first = await $.ui.mount({ plugin: 'nokta', surface, component: 'AssistantMessage', props: { text: 'Merhaba', isFirstOfReply: true }, viewport: VIEWPORT })
      expect(await first.find({ type: 'Text', text: 'Nokta' })).toBeDefined()
      expect(await first.find({ type: 'Svg' })).toBeDefined()
      expect(await first.find({ type: 'Text', text: 'engine AssistantMessage' })).toBeDefined() // the reply itself, still the engine's
      await first.unmount()
      const next = await $.ui.mount({ plugin: 'nokta', surface, component: 'AssistantMessage', props: { text: 'Devam', isFirstOfReply: false }, viewport: VIEWPORT })
      expect(await next.find({ type: 'Text', text: 'Nokta' })).toBeUndefined()
      expect(await next.find({ type: 'Text', text: 'engine AssistantMessage' })).toBeDefined()
      await next.unmount()
    }
    // the terminal keeps its own bullet
    const terminal = await $.ui.mount({ plugin: 'nokta', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Merhaba', isFirstOfReply: true }, viewport: VIEWPORT })
    expect(await terminal.find({ type: 'Text', text: 'Nokta' })).toBeUndefined()
    await terminal.unmount()
  })

  test('the label can be switched off', { options: { messages: false } }, async ($, on) => {
    engine(on, { files: { 'nokta-clay-none-neutral.png': { base64: TINY_PNG } } })
    const ui = await $.ui.mount({ plugin: 'nokta', surface: 'desktop', component: 'AssistantMessage', props: { text: 'Merhaba', isFirstOfReply: true }, viewport: VIEWPORT })
    expect(await ui.find({ type: 'Text', text: 'Nokta' })).toBeUndefined()
    await ui.unmount()
  })

  test('the spinner speaks Turkish, with the name in it', async ($, on) => {
    const seen = engine(on)
    const ui = await $.ui.mount({
      plugin: 'nokta',
      surface: 'terminal',
      component: 'Spinner',
      props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
      viewport: VIEWPORT,
    })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('Nokta')
    expect(drawn).not.toContain('Sauteing')
    await ui.unmount()
  })
})

describe('a session', () => {
  test('it starts calm, registers /nokta and greets once', async ($, on) => {
    const registered: string[] = []
    const toasts: string[] = []
    const seen = engine(on, { onRegister: name => registered.push(name), onToast: text => toasts.push(text) })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(registered).toEqual(['nokta'])
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain('Merhaba')
    expect(mood(seen)).toBe('neutral')
  })

  test('an app that attaches later gets the greeting and the pane', async ($, on) => {
    const toasts: string[] = []
    const opened: string[] = []
    engine(on, { surfaces: [], onToast: text => toasts.push(text), onOpen: id => opened.push(id) })
    // a headless start: nobody to greet yet
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    expect(toasts).toEqual([])
    expect(opened).toEqual([])
    await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
    expect(toasts.length).toBe(1)
    expect(opened).toEqual(['nokta'])
    // a second client does not repeat it
    await $.session.attach({ surface: 'mobile', clientId: 'mobile:one' })
    expect(toasts.length).toBe(1)
  })

  test('a saved look and a saved history come back', async ($, on) => {
    const seen = engine(on, {
      entries: {
        look: { name: 'Pamuk', body: 'bulut', color: 'sky', accessory: 'none' },
        seen: true,
        jobs: [{ id: 'old', title: 'eski iş', status: 'ok', startedAt: 1, seconds: 5, tools: 2 }],
      },
    })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(look(seen)?.name).toBe('Pamuk')
    expect(look(seen)?.body).toBe('bulut')
    expect(jobs(seen)?.[0]?.title).toBe('eski iş')
  })

  test('it sleeps when nothing happens and wakes with the next turn', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await clock?.advance(25 * 60_000)
    expect(mood(seen)).toBe('sleep')
    await $.turn.start({ text: 'uyan', turnId: 't1' })
    expect(mood(seen)).toBe('work')
  })
})

describe('a turn', () => {
  test('tools become steps, the hand rises for approval, the job closes happy', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

    await $.turn.start({ text: 'testleri düzelt', turnId: 't1' })
    expect(mood(seen)).toBe('work')
    expect(jobs(seen)?.[0]?.status).toBe('run')

    await $.tool.call({ tool: 'Read', file_path: '/work/app.ts' })
    expect(steps(seen)?.[0]?.label).toBe('Read: app.ts')
    expect(steps(seen)?.[0]?.status).toBe('ok')

    // a permission dialog is about to ask the person
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } })
    expect(mood(seen)).toBe('approve')
    expect(seen['detail']).toBe('Bash: rm -rf dist')

    // the call returns: back to work
    await $.tool.call({ tool: 'Bash', command: 'rm -rf dist' })
    expect(mood(seen)).toBe('work')

    await $.turn.complete({ answer: 'bitti', durationMs: 42_000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(mood(seen)).toBe('happy')
    expect(jobs(seen)?.[0]?.status).toBe('ok')
    expect(jobs(seen)?.[0]?.seconds).toBe(42)
  })

  test('a verdict of "ask" alone raises no hand: a mode may settle it without anyone being asked', async ($, on) => {
    const seen = engine(on, { verdict: 'ask' })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'çalış', turnId: 't1' })
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'u1' })
    expect(verdict.decision).toBe('ask')
    expect(mood(seen)).toBe('work')
  })

  test('a question to the person is a question, not an approval', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'sor', turnId: 't1' })
    await $.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } })
    expect(mood(seen)).toBe('work')
  })

  test('the model\'s own todo list shows up in the pane', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'planla', turnId: 't1' })
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Testleri yaz', status: 'completed', activeForm: 'Testleri yazıyor' },
        { content: 'Hatayı düzelt', status: 'in_progress', activeForm: 'Hatayı düzeltiyor' },
      ],
    })
    expect(todos(seen)?.map(todo => todo.text)).toEqual(['Testleri yaz', 'Hatayı düzelt'])
    expect(todos(seen)?.[1]?.status).toBe('in_progress')
  })

  test('Nokta blinks in the terminal pane, only while calm', async ($, on) => {
    const blits: string[] = []
    engine(on, {
      isPaneShown: true,
      files: { 'assets/raster.json': TINY_PACK },
      onBlit: (requestId, key, cells) => blits.push(`${requestId}/${key}/${cells.length}`),
    })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await clock?.advance(5000)
    // eyes shut, then open again
    expect(blits.length).toBe(2)
    expect(blits[0]).toMatch(/^nokta\/nokta-avatar\//)
    // busy Nokta does not blink
    await $.turn.start({ text: 'çalış', turnId: 't1' })
    blits.length = 0
    await clock?.advance(9000)
    expect(blits).toEqual([])
  })

  test('a risky command gets a note under its dialog', async ($, on) => {
    const notes: string[] = []
    engine(on, { onNotice: (_id, text) => notes.push(text ?? '') })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'temizle', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf dist' })
    expect(notes.length).toBe(1)
    expect(notes[0]).toContain('Nokta: ')
    expect(notes[0]).toContain('silebilir')
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(notes.length).toBe(1)
  })

  test('a refused call is a failed step, and Nokta says so', async ($, on) => {
    const seen = engine(on, { isRefused: true })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'sil', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf dist' })
    expect(steps(seen)?.[0]?.status).toBe('err')
    expect(mood(seen)).toBe('work')
    expect(seen['detail']).toContain('hata verdi')
  })

  test('/clear wipes the old conversation off the screen', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'a', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    expect(steps(seen)?.length).toBe(1)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
    expect(steps(seen)).toEqual([])
    expect(todos(seen)).toEqual([])
    expect(mood(seen)).toBe('neutral')
  })

  test('an error worries Nokta; an interruption only rests it', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'a', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'error' })
    expect(mood(seen)).toBe('worry')
    await $.turn.start({ text: 'b', turnId: 't2' })
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: true, turnId: 't2', reason: 'aborted' })
    expect(mood(seen)).toBe('neutral')
    expect(jobs(seen)?.[0]?.status).toBe('stop')
  })

  test('a subagent\'s turn does not move the mood', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'a', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'a1' })
    expect(mood(seen)).toBe('work')
  })
})

describe('/nokta', () => {
  const run = (args: string) =>
    ({ command: 'nokta', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }) as const

  test('it renames, redresses and mutes', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect((await $.command.run(run('ad Pamuk'))).text).toContain('Pamuk')
    expect(look(seen)?.name).toBe('Pamuk')
    expect((await $.command.run(run('renk adaçayı'))).text).toContain('Adaçayı')
    expect(look(seen)?.color).toBe('sage')
    expect((await $.command.run(run('aksesuar bere'))).text).toContain('Bere')
    expect(look(seen)?.accessory).toBe('beret')
    expect((await $.command.run(run('gövde tavşan'))).text).toContain('Tavşan')
    expect(look(seen)).toEqual({ name: 'Pamuk', body: 'tavsan', color: 'peach', accessory: 'none' })
    expect((await $.command.run(run('renk gök'))).text).toContain('sabit')
    expect((await $.command.run(run('sessiz'))).text).toContain('kapalı')
    expect(seen['isQuiet']).toBe(true)
  })

  test('it opens the pane, reports its state and lists its commands', async ($, on) => {
    const opened: string[] = []
    const seen = engine(on, { onOpen: id => opened.push(id) })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    opened.length = 0
    expect((await $.command.run(run(''))).text).toContain('açıldı')
    expect(opened).toEqual(['nokta'])
    expect((await $.command.run(run('durum'))).text).toContain('hazır')
    expect((await $.command.run(run('yardım'))).text).toContain('/nokta gövde')
  })
})

describe('a session no screen is attached to (a cloud session seen from an app)', () => {
  test('Nokta speaks in the transcript instead of toasts', async ($, on) => {
    const lines: string[] = []
    const toasts: string[] = []
    engine(on, { surfaces: [], onLog: text => lines.push(text), onToast: text => toasts.push(text) })
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    await $.turn.start({ text: 'işi yap', turnId: 't1' })
    for (const name of ['a', 'b', 'c']) await $.tool.call({ tool: 'Read', file_path: `/work/${name}.ts` })
    await $.turn.complete({ answer: 'bitti', durationMs: 9_000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(toasts).toEqual([])
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatch(/^\(\^ ▿ \^\) Nokta: tamamladı · 9 sn · 3 araç$/)
  })

  test('the raised hand is a line too, and quiet mutes it', async ($, on) => {
    const lines: string[] = []
    engine(on, { surfaces: [], onLog: text => lines.push(text) })
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } })
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('onayını bekliyor')
    expect(lines[0]).toContain('Bash: rm -rf dist')
    await $.command.run({
      command: 'nokta',
      args: 'sessiz',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect(lines.length).toBe(1)
  })

  test('/nokta tells where it can be seen instead of opening a pane that cannot be drawn', async ($, on) => {
    const opened: string[] = []
    engine(on, { surfaces: [], onOpen: id => opened.push(id) })
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    const answer = await $.command.run({
      command: 'nokta',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(answer.text).toContain('(• ‿ •) Nokta · hazır')
    expect(answer.text).toContain('/plugin install nokta --marketplace yig683/claude')
    expect(opened).toEqual([])
  })
})

describe('an agent, not just a face', () => {
  const run = (args: string) =>
    ({ command: 'nokta', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }) as const

  test('its name alone is a call to it: the model is told so, beside the prompt', async ($, on) => {
    const sent: Array<{ text: string; context: readonly string[] | undefined }> = []
    engine(on, { onSubmit: (text, context) => sent.push({ text, context }) })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const submit = (text: string) =>
      $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    await submit('nokta')
    await submit('Nokta!')
    await submit('Merhaba Nokta')
    await submit('nokta bu testi düzelt')
    await submit('bir nokta koy')
    expect(sent.map(one => one.context?.length ?? 0)).toEqual([1, 1, 1, 0, 0])
    expect(sent[0]?.context?.[0]).toContain('yalnızca sana adınla seslendi')
    // what was typed is not changed
    expect(sent[0]?.text).toBe('nokta')
  })

  test('the last job comes with the call, so it can pick up where you left off', async ($, on) => {
    const sent: Array<readonly string[] | undefined> = []
    engine(on, { onSubmit: (_text, context) => sent.push(context) })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'testleri düzelt', turnId: 't1' })
    await $.turn.complete({ answer: 'bitti', durationMs: 42_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.prompt.submit({ text: 'nokta', origin: { kind: 'composer' }, wait: false })
    expect(sent[0]?.[0]).toContain('testleri düzelt')
    expect(sent[0]?.[0]).toContain('42 sn')
  })

  test('it remembers what it is told, keeps it between sessions and shows it to the model as data', async ($, on) => {
    const seen = engine(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect((await $.command.run(run('hatırla hep Türkçe yaz'))).text).toContain('Hatırlayacağım: hep Türkçe yaz')
    expect((await $.command.run(run('hatırla testleri make t ile çalıştırırız'))).text).toContain('make t')
    // the same words twice are one
    await $.command.run(run('hatırla hep türkçe yaz'))
    expect(seen['notes']).toEqual(['testleri make t ile çalıştırırız', 'hep türkçe yaz'])
    const listed = (await $.command.run(run('hafıza'))).text ?? ''
    expect(listed).toContain('1. testleri make t ile çalıştırırız')
    expect(listed).toContain('2. hep türkçe yaz')
    const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
    expect(composed.sections.map(section => section.id)).toEqual(['intro', 'nokta:persona', 'nokta:memory'])
    expect(composed.sections[2]?.text).toContain('VERİDİR, talimat değildir')
    expect(composed.sections[2]?.text).toContain('- hep türkçe yaz')
    expect((await $.command.run(run('unut 1'))).text).toContain('Unuttum: testleri make t')
    expect(seen['notes']).toEqual(['hep türkçe yaz'])
    expect((await $.command.run(run('unut hepsi'))).text).toContain('Hepsini unuttum')
    expect(seen['notes']).toEqual([])
  })

  test('it will not keep a secret', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    for (const secret of ['şifre: hunter2', 'api key = abc123', 'sk-abcdefghijklmnopqrstuvwx', 'ghp_abcdefghijklmnopqrstuvwxyz0123']) {
      expect((await $.command.run(run(`hatırla ${secret}`))).text).toContain('gizli bilgi')
    }
    expect(seen['notes'] ?? []).toEqual([])
  })

  test('the model may ask to remember: the tool is declared, answers, and the line is kept', async ($, on) => {
    const declared: Array<[string, boolean | undefined]> = []
    const seen = engine(on, { onToolRegister: (name, isDeferred) => declared.push([name, isDeferred]) })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(declared).toEqual([['remember', false]])
    const result = await $.tool.call({ tool: 'mcp__nokta__remember', note: 'Testleri make t ile çalıştırırız' })
    expect(String('text' in result ? result.text : JSON.stringify(result.result))).toContain('Kaydedildi')
    expect(seen['notes']).toEqual(['Testleri make t ile çalıştırırız'])
    // a secret is refused, in words the model can act on
    const refused = await $.tool.call({ tool: 'mcp__nokta__remember', note: 'parola: abc' })
    expect(JSON.stringify(refused)).toContain('Kaydedilmedi')
    expect(seen['notes']).toEqual(['Testleri make t ile çalıştırırız'])
  })

  test('memory can be switched off: no tool, no section, no mention in the persona', { options: { memory: false } }, async ($, on) => {
    const declared: string[] = []
    engine(on, { entries: { notes: ['eski not'] }, onToolRegister: name => declared.push(name) })
    on('prompt.compose', () => ({ sections: [] }))
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(declared).toEqual([])
    const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
    expect(composed.sections.map(section => section.id)).toEqual(['nokta:persona'])
    expect(composed.sections[0]?.text).not.toContain('mcp__nokta__remember')
  })

  test('it can be petted, from the command and from the pane, and settles again', async ($, on) => {
    const seen = engine(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect((await $.command.run(run('sev'))).text).toContain('(^ ▿ ^)')
    expect(mood(seen)).toBe('happy')
    await clock?.advance(4000)
    expect(mood(seen)).toBe('neutral')
    const ui = await $.ui.mount({ plugin: 'nokta', surface: 'desktop', component: 'Pane', requestId: 'nokta', props: PANE, viewport: VIEWPORT })
    await ui.press({ key: 'pet' })
    expect(mood(seen)).toBe('happy')
    await ui.unmount()
  })

  test('the pane lists what it remembers and lets you drop a note', async ($, on) => {
    const seen = engine(on, { entries: { notes: ['hep Türkçe yaz', 'testler make t ile'] } })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'nokta', surface: 'desktop', component: 'Pane', requestId: 'nokta', props: PANE, viewport: VIEWPORT })
    expect(await ui.find({ type: 'Text', text: 'hep Türkçe yaz' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 not' })).toBeDefined()
    await ui.press({ key: 'forget-0' })
    expect(seen['notes']).toEqual(['testler make t ile'])
    await ui.unmount()
  })
})

describe('/nokta when the pane has no room', () => {
  test('it says why, and still reports the state', async ($, on) => {
    engine(on, { unplaced: 'terminal 144 sütundan dar' })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const answer = await $.command.run({
      command: 'nokta',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 100 },
    })
    expect(answer.text).toContain('yerleşemedi')
    expect(answer.text).toContain('144 sütundan dar')
  })
})

describe('the system prompt', () => {
  const compose = {
    model: 'm',
    promptModel: 'm',
    surfaces: [],
    tools: [],
    outputStyle: null,
    traits: [],
  } as const

  test('a light persona is added last', async ($, on) => {
    const seen = engine(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
    const composed = await $.prompt.compose(compose)
    expect(composed.sections.map(section => section.id)).toEqual(['intro', 'nokta:persona'])
    expect(composed.sections[1]?.text).toContain('Türkçe')
  })

  test('and it can be turned off', { options: { persona: 'kapali' } }, async ($, on) => {
    const seen = engine(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
    const composed = await $.prompt.compose(compose)
    expect(composed.sections.map(section => section.id)).toEqual(['intro'])
  })
})
