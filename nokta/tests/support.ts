// Stand-ins for what the browser gives a surface module: a document whose canvas has a WebGL 2 context that counts what
// it is told, and a clock held still until a test moves it. (The test kit runs a module outside a browser.)

export type Canvas = {
  width: number
  height: number
  listeners: Record<string, (event: { preventDefault: () => void }) => void>
  isLost: boolean
  draws: number
  palettes: number
  lastU: Float32Array | undefined
  /** the samples to a pixel it was asked to draw with, each frame */
  samples: number[]
  encoded: string[]
  context: object
}

export type DocumentOptions = {
  noWebgl?: boolean
  failCompile?: boolean
  onDraw?: () => void
  /** the driver builds the program on its own time, and says it is done after this many looks (the extension is there) */
  parallelAfter?: number
  /** how many characters a picture of each kind has, over the few that are always there */
  pngChars?: number
  webpChars?: number
}

/** The browser's document as far as the module touches it: a canvas with a WebGL 2 context that counts what it is told. */
export function installDocument(options: DocumentOptions = {}) {
  const canvases: Canvas[] = []
  const COMPLETION = 0x91b1
  let polls = 0
  const g = globalThis as unknown as { document?: unknown }
  const had = g.document
  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`)
      const c: Canvas = {
        width: 0,
        height: 0,
        listeners: {},
        isLost: false,
        draws: 0,
        palettes: 0,
        lastU: undefined,
    samples: [],
        encoded: [],
        context: {},
      }
      c.context = {
        VERTEX_SHADER: 1,
        FRAGMENT_SHADER: 2,
        COMPILE_STATUS: 3,
        LINK_STATUS: 4,
        COLOR_BUFFER_BIT: 5,
        VERSION: 6,
        TRIANGLES: 7,
        createShader: () => ({}),
        shaderSource: () => undefined,
        compileShader: () => undefined,
        getShaderParameter: () => options.failCompile !== true,
        getShaderInfoLog: () => 'ERROR: 0:12: boom',
        createProgram: () => ({}),
        attachShader: () => undefined,
        linkProgram: () => undefined,
        getProgramParameter: (_p: unknown, what: number) => {
          if (what !== COMPLETION) return true
          polls += 1
          return polls > (options.parallelAfter ?? 0)
        },
        getProgramInfoLog: () => '',
        useProgram: () => undefined,
        viewport: () => undefined,
        clearColor: () => undefined,
        getExtension: (name: string) => (name === 'KHR_parallel_shader_compile' && options.parallelAfter !== undefined ? { COMPLETION_STATUS_KHR: COMPLETION } : null),
        getParameter: () => 'Stand-in GL 2',
        getUniformLocation: (_p: unknown, name: string) => name,
        uniform1fv: () => {
          c.palettes += 1
        },
        uniform2f: () => undefined,
    uniform1i: (_loc: string, v: number) => {
      c.samples.push(v)
    },
        uniform4fv: (_loc: string, v: Float32Array) => {
          c.lastU = Float32Array.from(v)
        },
        clear: () => undefined,
        drawArrays: () => {
          c.draws += 1
          options.onDraw?.()
        },
        isContextLost: () => c.isLost,
      }
      canvases.push(c)
      return {
        get width() {
          return c.width
        },
        set width(v: number) {
          c.width = v
        },
        get height() {
          return c.height
        },
        set height(v: number) {
          c.height = v
        },
        addEventListener: (type: string, fn: (event: { preventDefault: () => void }) => void) => {
          c.listeners[type] = fn
        },
        getContext: (kind: string) => (kind === 'webgl2' && options.noWebgl !== true ? c.context : null),
        toDataURL: (type: string) => {
          c.encoded.push(type)
          return `data:${type};base64,AAAA${'A'.repeat((type === 'image/png' ? options.pngChars : options.webpChars) ?? 0)}`
        },
      }
    },
  }
  return {
    canvases,
    restore: () => {
      g.document = had
    },
  }
}

/** The browser's clock, held still until the test moves it. */
export function installClock() {
  const g = globalThis as unknown as { performance?: unknown }
  const had = Object.getOwnPropertyDescriptor(globalThis, 'performance')
  let t = 100_000
  Object.defineProperty(globalThis, 'performance', { configurable: true, writable: true, value: { now: () => t } })
  return {
    advance: (ms: number) => {
      t += ms
    },
    restore: () => {
      if (had !== undefined) Object.defineProperty(globalThis, 'performance', had)
      else g.performance = undefined
    },
  }
}
