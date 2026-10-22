import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { appCommand, termKey } from './shortcuts'
import { oscRgb } from '../../shared/color'
import { zoomFont } from './zoom'
import { unwrap } from './ipc'

// Zoom por aba (Ctrl+scroll): diferença em px sobre a fonte das Configurações, salva por id.
const zoomKey = (id: string): string => `turnflow.zoom.${id}`
const zoomOf = (id: string): number => {
  try {
    return Number(localStorage.getItem(zoomKey(id))) || 0
  } catch {
    return 0
  }
}
const saveZoom = (id: string, delta: number): void => {
  try {
    if (delta) localStorage.setItem(zoomKey(id), String(delta))
    else localStorage.removeItem(zoomKey(id))
  } catch {
    // sem storage: zoom só não sobrevive ao reload
  }
}

let termTheme: Record<string, string> = {
  background: '#14161a',
  foreground: '#c9d1d9',
  cursor: '#c9d1d9',
  selectionBackground: '#3b4a63'
}
let termFont = 13
let termFamily = "'JetBrains Mono', monospace"

export function setTermTheme(
  theme: Record<string, string>,
  fontSize: number,
  fontFamily: string
): void {
  termTheme = theme
  termFont = fontSize
  termFamily = fontFamily
  for (const e of terms.values()) {
    e.term.options.theme = theme
    e.term.options.fontSize = zoomFont(fontSize + zoomOf(e.ref.id), 0)
    e.term.options.fontFamily = fontFamily
  }
  refitAll()
}

// O xterm só mede a fonte nova no próximo frame; fit antes disso calcula colunas a mais
// e o texto passa da borda direita.
function refitAll(): void {
  const run = (): void => {
    for (const e of terms.values()) if (e.el.isConnected) e.fit.fit()
  }
  requestAnimationFrame(() => requestAnimationFrame(run))
  document.fonts?.ready.then(run)
}

// Um xterm por task, vivo enquanto o PTY existir: trocar/fechar aba só desanexa o elemento.
type Entry = { term: Terminal; fit: FitAddon; el: HTMLDivElement; ref: { id: string } }
const terms = new Map<string, Entry>()

let wired = false
function wire(): void {
  if (wired) return
  wired = true
  window.turnflow.onData((id, d) => {
    terms.get(id)?.term.write(d)
  })
}

export function getTerm(id: string): Entry {
  wire()
  let e = terms.get(id)
  if (e) return e
  const ref = { id }
  const el = document.createElement('div')
  el.className = 'term-host'
  // arrastar arquivo pro terminal cola o caminho, como num terminal comum
  el.addEventListener('drop', (ev) => {
    const files = [...(ev.dataTransfer?.files ?? [])]
    if (!files.length) return
    const q = (p: string): string =>
      /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p
    e?.term.paste(files.map((f) => q(window.turnflow.pathForFile(f))).join(' ') + ' ')
  })
  // Ctrl+scroll: zoom só desta aba (o Chromium zoomaria a janela inteira)
  el.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey || !e) return
      ev.preventDefault()
      const size = zoomFont(e.term.options.fontSize ?? termFont, ev.deltaY)
      if (size === e.term.options.fontSize) return
      e.term.options.fontSize = size
      saveZoom(ref.id, size - termFont)
      e.fit.fit()
    },
    { passive: false, capture: true }
  )
  const term = new Terminal({
    fontFamily: termFamily,
    fontSize: zoomFont(termFont + zoomOf(id), 0),
    scrollback: 10000,
    allowProposedApi: true,
    theme: termTheme
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // atalho do app não chega no PTY; Ctrl+C/V e Shift+Enter tratados aqui
  term.attachCustomKeyEventHandler((e) => {
    if (appCommand(e)) return false
    // Esc interrompe o claude e nenhum hook avisa: a bolinha sairia do verde só no próximo evento
    if (e.type === 'keydown' && e.key === 'Escape')
      window.dispatchEvent(new CustomEvent('dk:esc', { detail: ref.id }))
    const cmd = termKey(e, term.hasSelection())
    if (!cmd) return true
    if (e.type !== 'keydown') return false
    e.preventDefault()
    if (cmd === 'copy') {
      window.turnflow.writeClipboard({ text: term.getSelection() })
      term.clearSelection()
    } else if (cmd === 'paste') {
      // só imagem na área de transferência: deixa o claude colar (ele lê o clipboard no Ctrl+V)
      unwrap(window.turnflow.readClipboard()).then((c) => {
        if (c?.text) term.paste(c.text)
        else if (c?.image) window.turnflow.write({ id: ref.id, data: '\x16' })
      })
    } else window.turnflow.write({ id: ref.id, data: '\x1b\r' }) // Shift+Enter: Alt+Enter é quebra de linha no claude
    return false
  })
  term.onData((data) => window.turnflow.write({ id: ref.id, data }))
  // O claude consulta as cores (OSC 10/11) no boot e espera resposta; o xterm.js não responde sozinho.
  // Responde com as cores do tema atual: o claude escolhe paleta clara/escura por elas.
  const reply = (code: number, key: 'foreground' | 'background') => (data: string) => {
    if (data !== '?') return false
    const rgb =
      oscRgb(termTheme[key] ?? '') ??
      (key === 'background' ? 'rgb:1414/1616/1a1a' : 'rgb:c9c9/d1d1/d9d9')
    window.turnflow.write({ id: ref.id, data: `\x1b]${code};${rgb}\x1b\\` })
    return true
  }
  term.parser.registerOscHandler(10, reply(10, 'foreground'))
  term.parser.registerOscHandler(11, reply(11, 'background'))
  term.onResize(({ cols, rows }) => window.turnflow.resize({ id: ref.id, cols, rows }))
  e = { term, fit, el, ref }
  terms.set(id, e)
  return e
}

// Anexa no container; o open só pode acontecer com o elemento no DOM.
export function attachTerm(id: string, host: HTMLElement): Entry {
  const e = getTerm(id)
  host.appendChild(e.el)
  if (!e.term.element) {
    e.term.open(e.el)
    // GPU: rolagem fluida em saída grande; sem contexto WebGL fica no renderer DOM
    try {
      const gl = new WebglAddon()
      gl.onContextLoss(() => gl.dispose())
      e.term.loadAddon(gl)
    } catch {
      // sem WebGL
    }
  }
  e.fit.fit()
  return e
}

export const hasTerm = (id: string): boolean => terms.has(id)
export const liveTerms = (): string[] => [...terms.keys()]

export function disposeTerm(id: string): void {
  terms.get(id)?.term.dispose()
  terms.get(id)?.el.remove()
  terms.delete(id)
}

// aba avulsa adotada pela task: o mesmo xterm passa a responder pelo id da task
export function renameTerm(from: string, to: string): void {
  const e = terms.get(from)
  if (!e || terms.has(to)) return
  terms.delete(from)
  e.ref.id = to
  terms.set(to, e)
  saveZoom(to, zoomOf(from))
  saveZoom(from, 0)
}
