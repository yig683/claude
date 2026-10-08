export type NoktaMood = 'neutral' | 'work' | 'ask' | 'approve' | 'happy' | 'worry' | 'sleep'
export type NoktaBody = 'nokta' | 'bulut' | 'tavsan' | 'ucgen'
export type NoktaColor = 'clay' | 'sky' | 'sage' | 'kraft' | 'ink' | 'peach'
export type NoktaAccessory = 'none' | 'glasses' | 'beret' | 'bowtie'

/** The character the person designed: name, body, colour and accessory. */
export type NoktaLook = {
  name: string
  body: NoktaBody
  color: NoktaColor
  accessory: NoktaAccessory
}

/** One tool call of the running turn, as a line in the pane. */
export type NoktaStep = { id: string; label: string; status: 'run' | 'ok' | 'err' }

/** One entry of the model's own todo list (TodoWrite), shown in the pane. */
export type NoktaTodo = {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** One turn, as a "project" of the character: what was asked and how it went. */
export type NoktaJob = {
  id: string
  title: string
  status: 'run' | 'ok' | 'err' | 'stop'
  startedAt: number
  seconds: number
  tools: number
}

declare module 'claude-code' {
  interface PluginState {
    nokta: {
      mood: NoktaMood
      detail: string
      look: NoktaLook
      steps: NoktaStep[]
      todos: NoktaTodo[]
      jobs: NoktaJob[]
      isBandHidden: boolean
      isQuiet: boolean
    }
  }
}
