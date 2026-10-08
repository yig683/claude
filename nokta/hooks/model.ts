// Pure logic of the Nokta mod: looks, moods, labels, risk notes, command parsing.
// Nothing here touches `$`, so the tests can run it as plain code.
import type { NoktaAccessory, NoktaBody, NoktaColor, NoktaLook, NoktaMood } from '../types'

export const BODIES: readonly NoktaBody[] = ['nokta', 'bulut', 'tavsan', 'ucgen']
export const COLORS: readonly NoktaColor[] = ['clay', 'sky', 'sage', 'kraft', 'ink']
export const ACCESSORIES: readonly NoktaAccessory[] = ['none', 'glasses', 'beret', 'bowtie']

export const BODY_LABEL: Record<NoktaBody, string> = {
  nokta: 'Nokta',
  bulut: 'Bulut',
  tavsan: 'Tavşan',
  ucgen: 'Üçgen',
}
export const COLOR_LABEL: Record<NoktaColor, string> = {
  clay: 'Kil',
  sky: 'Gök',
  sage: 'Adaçayı',
  kraft: 'Kraft',
  ink: 'Mürekkep',
  peach: 'Şeftali',
}
export const ACCESSORY_LABEL: Record<NoktaAccessory, string> = {
  none: 'Yok',
  glasses: 'Gözlük',
  beret: 'Bere',
  bowtie: 'Papyon',
}

/** Every body has its own colour; only Nokta itself is dressed in the five tones. */
export const DEFAULT_COLOR: Record<NoktaBody, NoktaColor> = {
  nokta: 'clay',
  bulut: 'sky',
  tavsan: 'peach',
  ucgen: 'ink',
}

export const DEFAULT_LOOK: NoktaLook = {
  name: 'Nokta',
  body: 'nokta',
  color: 'clay',
  accessory: 'none',
}

/** A look that can actually be drawn: colour and accessory belong to Nokta alone. */
export function normalizeLook(look: Partial<NoktaLook> | undefined): NoktaLook {
  const body = BODIES.includes(look?.body as NoktaBody) ? (look?.body as NoktaBody) : 'nokta'
  const name = clip((look?.name ?? '').trim(), 24) || 'Nokta'
  if (body !== 'nokta') {
    return { name, body, color: DEFAULT_COLOR[body], accessory: 'none' }
  }
  const color = COLORS.includes(look?.color as NoktaColor) ? (look?.color as NoktaColor) : 'clay'
  const accessory = ACCESSORIES.includes(look?.accessory as NoktaAccessory)
    ? (look?.accessory as NoktaAccessory)
    : 'none'
  return { name, body, color, accessory }
}

/** The file stem of the icon for a look in a mood: assets/icons/<key>.png */
export function iconKey(look: NoktaLook, mood: NoktaMood): string {
  return `${look.body}-${look.color}-${look.accessory}-${mood}`
}

export const MOOD: Record<NoktaMood, { label: string; face: string; color: string }> = {
  neutral: { label: 'hazır', face: '(• ‿ •)', color: '#2D8A4E' },
  work: { label: 'çalışıyor', face: '(• _ •)', color: '#D97757' },
  ask: { label: 'soru soruyor', face: '(• o •)', color: '#6E96B8' },
  approve: { label: 'onay bekliyor', face: '\\(• ▿ •)', color: '#C2532F' },
  happy: { label: 'tamamladı', face: '(^ ▿ ^)', color: '#2D8A4E' },
  worry: { label: 'sorun var', face: '(• ~ •)', color: '#A3322A' },
  sleep: { label: 'uyuyor', face: '(- _ -)', color: '#8A867D' },
}

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s} sn`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return r === 0 ? `${m} dk` : `${m} dk ${r} sn`
  const h = Math.floor(m / 60)
  return `${h} sa ${m % 60} dk`
}

function baseName(path: unknown): string {
  const p = typeof path === 'string' ? path : ''
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** One short line saying what a tool call does, for the pane and the status line. */
export function describeTool(tool: string, input: Record<string, unknown>): string {
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
      return `Bash: ${clip(str('command'), 56)}`
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      return `${tool}: ${baseName(input['file_path'] ?? input['notebook_path'])}`
    case 'Grep':
      return `Grep: ${clip(str('pattern'), 40)}`
    case 'Glob':
      return `Glob: ${clip(str('pattern'), 40)}`
    case 'WebFetch': {
      const url = str('url')
      const host = url.replace(/^https?:\/\//, '').split('/')[0] ?? url
      return `WebFetch: ${clip(host, 40)}`
    }
    case 'WebSearch':
      return `Arama: ${clip(str('query'), 44)}`
    case 'Agent':
    case 'Task':
      return `Alt ajan: ${clip(str('description') || str('subagent_type'), 44)}`
    case 'TodoWrite':
      return 'Görev listesini güncelledi'
    case 'AskUserQuestion':
      return 'Sana bir soru soruyor'
    default:
      return tool.startsWith('mcp__') ? `${tool.replace(/^mcp__/, '').replace(/__/g, ' / ')}` : tool
  }
}

const COMMAND_RISKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, 'Bu komut dosyaları kalıcı olarak silebilir.'],
  [/\bgit\s+push\b[^\n]*(--force|--force-with-lease|\s-f\b)/, 'Force-push, uzak deponun geçmişini yeniden yazar.'],
  [/\bgit\s+push\b/, 'Değişiklikleri uzak depoya gönderir.'],
  [/\bgit\s+reset\s+--hard\b/, 'Kaydedilmemiş değişiklikleri siler.'],
  [/\bgit\s+clean\b/, 'Takip edilmeyen dosyaları siler.'],
  [/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'İnternetten indirilen betiği doğrudan çalıştırır.'],
  [/\bsudo\b/, 'Yönetici yetkisiyle çalışır.'],
  [/\b(chmod|chown)\s+-R\b/, 'İzinleri klasör boyunca toplu değiştirir.'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/, 'Paketi herkese açık yayınlar.'],
  [/\b(pip3?|npm|pnpm|yarn|apt(-get)?|brew)\s+(install|add|i)\b/, 'Makineye yeni paket kurar.'],
  [/\b(DROP\s+(TABLE|DATABASE)|TRUNCATE)\b/i, 'Veritabanında veri siler.'],
  [/\bdd\s+if=|\bmkfs\b|>\s*\/dev\/(sd|nvme)/, 'Diske doğrudan yazar.'],
  [/\b(kubectl\s+(delete|apply)|terraform\s+(apply|destroy))\b/, 'Canlı altyapıyı değiştirir.'],
]

/** A one-line, plain-language note for a call that asks for permission. */
export function riskNote(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === 'Bash') {
    const command = typeof input['command'] === 'string' ? (input['command'] as string) : ''
    for (const [pattern, note] of COMMAND_RISKS) {
      if (pattern.test(command)) return note
    }
    return undefined
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') {
    return `Dosyayı değiştirir: ${baseName(input['file_path'] ?? input['notebook_path'])}.`
  }
  if (tool === 'WebFetch') {
    const url = typeof input['url'] === 'string' ? (input['url'] as string) : ''
    return `${clip(url.replace(/^https?:\/\//, '').split('/')[0] ?? url, 40)} adresine istek gönderir.`
  }
  if (tool.startsWith('mcp__')) {
    return 'Bağlı bir dış araç çalışır; sonuçları sohbete gelir.'
  }
  return undefined
}

/** The turn's title: the first line of what was asked. */
export function titleOf(text: string): string {
  const first = text.split('\n').find(line => line.trim() !== '') ?? ''
  return clip(first, 80) || 'Yeni iş'
}

/** Folds Turkish letters and case, so "Tavşan", "tavsan" and "TAVŞAN" are the same word. */
export function fold(word: string): string {
  return word
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim()
}

const BODY_WORDS: Record<string, NoktaBody> = {
  nokta: 'nokta', dot: 'nokta',
  bulut: 'bulut', cloud: 'bulut',
  tavsan: 'tavsan', rabbit: 'tavsan',
  ucgen: 'ucgen', triangle: 'ucgen',
}
const COLOR_WORDS: Record<string, NoktaColor> = {
  kil: 'clay', clay: 'clay',
  gok: 'sky', sky: 'sky',
  adacayi: 'sage', sage: 'sage',
  kraft: 'kraft',
  murekkep: 'ink', ink: 'ink',
}
const ACCESSORY_WORDS: Record<string, NoktaAccessory> = {
  yok: 'none', none: 'none',
  gozluk: 'glasses', glasses: 'glasses',
  bere: 'beret', beret: 'beret',
  papyon: 'bowtie', bowtie: 'bowtie',
}

export function parseBody(word: string): NoktaBody | undefined {
  return BODY_WORDS[fold(word)]
}
export function parseColor(word: string): NoktaColor | undefined {
  return COLOR_WORDS[fold(word)]
}
export function parseAccessory(word: string): NoktaAccessory | undefined {
  return ACCESSORY_WORDS[fold(word)]
}

/** The next value after `current` in a list, wrapping around. */
export function nextOf<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current)
  const next = list[(i + 1) % list.length]
  return next ?? current
}

export const HELP = [
  '/nokta            paneli aç',
  '/nokta durum      şu anki durum ve son işler',
  '/nokta ad <ad>    adını değiştir',
  '/nokta gövde <nokta|bulut|tavşan|üçgen>',
  '/nokta renk <kil|gök|adaçayı|kraft|mürekkep>   (yalnızca Nokta gövdesi)',
  '/nokta aksesuar <yok|gözlük|bere|papyon>       (yalnızca Nokta gövdesi)',
  '/nokta sessiz     bildirim ve sesleri aç/kapat',
  '/nokta bant       durum bandını göster/gizle',
  '/nokta yardım     bu liste',
].join('\n')

/** The system-prompt section of the light persona. */
export function personaText(name: string): string {
  return [
    `Bu oturumda kullanıcının yanındaki yardımcının adı ${name}. Kendini gerekirse ${name} diye tanıtabilirsin ama gösterişe kaçma.`,
    'Kullanıcı Türkçe yazıyorsa Türkçe cevap ver: sıcak, kısa ve net ol; uzun giriş ve gereksiz özür yok. Kullanıcı başka bir dille yazarsa o dille devam et.',
    'Bir işe başlamadan önce ne yapacağını tek cümleyle söyle. İş bitince sonucu ve (varsa) kullanıcıdan beklediğin adımı bir iki cümleyle özetle.',
    'Riskli ya da geri alınması zor bir adımdan önce (silme, force-push, ödeme, dış servise veri gönderme) nedenini bir cümleyle söyle ve onay iste.',
    'Kod, komut ve dosya adlarını olduğu gibi bırak; yalnızca anlatım Türkçe olsun.',
  ].join('\n')
}

/** The Turkish words the terminal's spinner shows while a turn runs. */
export function spinnerWord(name: string, mode: string, seed: string): string {
  const pick = (list: readonly string[]): string => {
    let h = 0
    for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
    return list[h % list.length] ?? list[0] ?? ''
  }
  switch (mode) {
    case 'thinking':
      return pick([`${name} düşünüyor`, `${name} kafa yoruyor`, `${name} hesaplıyor`])
    case 'requesting':
      return pick([`${name} bağlanıyor`, `${name} haber bekliyor`])
    case 'tool-input':
      return pick([`${name} hazırlanıyor`, `${name} not alıyor`])
    case 'tool-use':
      return pick([`${name} çalışıyor`, `${name} uğraşıyor`, `${name} kolları sıvadı`])
    case 'responding':
      return pick([`${name} yazıyor`, `${name} toparlıyor`])
    default:
      return `${name} çalışıyor`
  }
}
