import { JSDOM } from 'jsdom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8')
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8')

const DEFAULT_HTML = `<!DOCTYPE html>
<html>
  <body>
    <div class="container-fluid">first-container</div>
    <div class="container-fluid">
      <input id="astcmd" />
      <button id="send"></button>
      <pre>pre[0]</pre>
      <pre>pre[1]</pre>
      <pre id="cli-output"></pre>
    </div>
  </body>
</html>`

export function bootDOM({ html = DEFAULT_HTML } = {}) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true })
  const { window } = dom

  const timers = []
  let nextId = 1

  window.setTimeout = (fn, ms) => {
    const id = nextId++
    timers.push({ id, fn, ms, type: 'timeout', cleared: false })
    return id
  }
  window.clearTimeout = (id) => {
    const t = timers.find((t) => t.id === id)
    if (t) t.cleared = true
  }
  window.setInterval = (fn, ms) => {
    const id = nextId++
    timers.push({ id, fn, ms, type: 'interval', cleared: false })
    return id
  }
  window.clearInterval = (id) => {
    const t = timers.find((t) => t.id === id)
    if (t) t.cleared = true
  }

  appendScript(window, utilsSource)
  appendScript(window, mainSource)

  return {
    dom,
    window,
    document: window.document,
    flushTimeouts() {
      const due = timers.filter((t) => !t.cleared && t.type === 'timeout')
      due.forEach((t) => {
        t.cleared = true
        t.fn()
      })
    },
    pendingTimeouts() {
      return timers.filter((t) => !t.cleared && t.type === 'timeout')
    },
    pendingIntervals() {
      return timers.filter((t) => !t.cleared && t.type === 'interval')
    },
  }
}

function appendScript(window, source) {
  const s = window.document.createElement('script')
  s.textContent = source
  window.document.body.appendChild(s)
}
