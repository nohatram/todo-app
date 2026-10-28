import './style.css'
import { createClient, Conflict, AuthError } from './github.js'
import { createEditor } from './editor.js'
import { createLocalClient } from 'virtual:local'

// The artifact build keeps files in this browser instead of GitHub (see local.js).
const LOCAL = import.meta.env.MODE === 'artifact'

const HOME = 'todo.md'
const SAVE_DELAY = 1200
const $ = (id) => document.getElementById(id)

const store = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
  del: (k) => { try { localStorage.removeItem(k) } catch {} },
}

let gh = null
let doc = { path: null, sha: null, saved: '' } // what GitHub has
let timer = null
let saving = null
let conflict = false

const editor = createEditor($('editor'), {
  onChange: changed,
  onLink: openTask,
  onBack: () => back(),
  onImage: saveImage,
  loadImage,
})

// ---------- images ----------
// Images are saved to assets/ in the repo and linked with normal markdown, relative to the page.
const imageUrls = new Map() // repo path -> object URL
const MAX_SIDE = 1600

function repoPathOf(src) {
  if (/^(https?:|data:|blob:)/.test(src)) return null
  const dir = doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/') + 1) : ''
  return decodeURIComponent(new URL(src, `https://repo/${dir}`).pathname.slice(1))
}

async function loadImage(src) {
  const path = repoPathOf(src)
  if (!path) return src
  if (imageUrls.has(path)) return imageUrls.get(path)
  const blob = await gh.getBlob(path)
  if (!blob) throw new Error('missing')
  const u = URL.createObjectURL(blob)
  imageUrls.set(path, u)
  return u
}

// Phone photos are huge; keep the long side to 1600px so the repo stays small and pages load fast.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 700_000) return { blob: file, ext: (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg') }
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height) // transparent areas become white, not black
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85))
    return { blob, ext: 'jpg' }
  } catch {
    return { blob: file, ext: (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg') }
  }
}

async function saveImage(file) {
  if (!gh || !doc.path) return null
  const { blob, ext } = await shrink(file)
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  const name = `assets/${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}.${ext}`
  imageUrls.set(name, URL.createObjectURL(blob)) // shows right away while it uploads
  upload(name, blob)
  return doc.path.includes('/') ? `../${name}` : name
}

async function upload(name, blob) {
  status('Saving image')
  try {
    await gh.putFile(name, blob, `add image ${name}`)
    status(store.get(draftKey(doc.path)) ? 'Editing' : 'Saved', 'quiet')
  } catch (e) {
    status('Image not saved', 'warn')
    banner(e instanceof AuthError ? e.message : "Couldn't save the image to GitHub. It's only on this device until it uploads.", [['Try again', () => { banner(''); upload(name, blob) }]])
  }
}


// ---------- status + banner ----------
function status(text, tone = '') {
  const s = $('status')
  s.textContent = text
  s.dataset.tone = tone
}
function banner(text, actions = []) {
  const b = $('banner')
  b.hidden = !text
  b.replaceChildren()
  if (!text) return
  const p = document.createElement('p')
  p.textContent = text
  b.append(p)
  for (const [label, fn] of actions) {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.onclick = fn
    b.append(btn)
  }
}

// ---------- routing ----------
const pathFromHash = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')) || HOME
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const titleOf = (path) => {
  if (path === HOME) return 'List'
  const words = path.replace(/^tasks\//, '').replace(/\.md$/, '').replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// ---------- the trail of pages you came through ----------
// Opening a page from another page remembers where you were, so Esc steps back one level at a time.
// Kept for the session, so a reload deep in the trail still knows the way back.
let trail = (() => { try { return JSON.parse(sessionStorage.getItem('trail')) || [] } catch { return [] } })()
const saveTrail = () => { try { sessionStorage.setItem('trail', JSON.stringify(trail)) } catch {} }

function openTask(slug, area) {
  const path = `tasks/${slugify(slug)}.md`
  if (path === doc.path) return
  // a page opened from another page takes its work/personal tag
  if (!area && doc.path !== HOME) area = /^area:\s*(\w+)/m.exec(editor.text())?.[1] || ''
  store.set(`area:${path}`, area)
  trail.push(doc.path); saveTrail()
  go(path)
}

function back() {
  if (doc.path === HOME) return false
  const prev = trail.pop() ?? HOME
  saveTrail()
  go(prev)
  return true
}

// jump straight to a level above: everything below it is forgotten
function jumpTo(path) {
  const i = trail.lastIndexOf(path)
  trail = path === HOME || i < 0 ? [] : trail.slice(0, i)
  saveTrail()
  go(path)
}

const nameOf = (path) => (path === HOME ? 'todo' : path.replace(/^tasks\//, '').replace(/\.md$/, ''))
function renderPath(path) {
  const nav = $('path')
  nav.replaceChildren()
  let chain = path === HOME ? [HOME] : [...(trail[0] === HOME ? [] : [HOME]), ...trail, path]
  // long trails keep the first level and the last two
  const hidden = chain.length > 4
  if (hidden) chain = [chain[0], null, ...chain.slice(-3)]
  chain.forEach((p, i) => {
    if (i) nav.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: '/' }))
    if (p === null) { nav.append(Object.assign(document.createElement('span'), { className: 'gap', textContent: '…' })); return }
    const here = i === chain.length - 1
    const b = Object.assign(document.createElement('button'), { className: here ? 'crumb here' : 'crumb', textContent: nameOf(p) })
    b.onclick = here ? () => window.scrollTo({ top: 0, behavior: 'smooth' }) : () => jumpTo(p)
    if (here) b.setAttribute('aria-current', 'page')
    nav.append(b)
  })
}

// The artifact frame doesn't allow path-style hashes, so it navigates in memory.
function go(path) {
  if (LOCAL) open(path)
  else location.hash = path === HOME ? '' : `/${path}`
}

// The browser's own back and forward buttons keep the trail in step.
if (!LOCAL) window.addEventListener('hashchange', () => {
  const path = pathFromHash()
  if (path === HOME) trail = []
  else if (trail[trail.length - 1] === path) trail.pop()
  saveTrail()
  open(path)
})

// ---------- load + save ----------
const draftKey = (p) => `draft:${p}`

function template(path) {
  const area = store.get(`area:${path}`, '')
  return `---\narea: ${area}\nstatus: open\n---\n# ${titleOf(path)}\n\n## Notes\n\n\n## Claude\n`
}

// Where the cursor goes when a page opens: back where you left the list, or under Notes on a task page.
const cursors = {}
function settle(path, focus) {
  const text = editor.text()
  let at = cursors[path]
  if (at == null && path !== HOME) {
    const notes = text.indexOf('## Notes\n')
    at = notes < 0 ? text.length : notes + '## Notes\n'.length
  }
  editor.place(Math.min(at ?? 0, text.length), focus)
}

async function open(path) {
  // Keep keyboard focus across pages on a computer; on a phone, don't pop the keyboard.
  const focus = editor.view.hasFocus && matchMedia('(pointer: fine)').matches
  if (doc.path) cursors[doc.path] = editor.view.state.selection.main.head
  await flush()
  try { await load(path) } finally { if (doc.path === path) settle(path, focus) }
}

async function load(path) {
  clearTimeout(timer)
  conflict = false
  banner('')
  $('back').hidden = path === HOME
  document.body.classList.toggle('is-task', path !== HOME)
  if (path === HOME) { trail = []; saveTrail() }
  renderPath(path)
  document.title = titleOf(path)

  // Show the local copy instantly, then reconcile with GitHub.
  const draft = store.get(draftKey(path))
  const cached = store.get(`cache:${path}`)
  doc = { path, sha: cached?.sha ?? null, saved: cached?.text ?? '' }
  editor.load(draft?.text ?? cached?.text ?? '', { fresh: true })
  status('Loading')

  try {
    const remote = await gh.get(path)
    if (doc.path !== path) return
    if (!remote) {
      doc = { path, sha: null, saved: '' }
      if (!draft) editor.load(path === HOME ? '## Today\n\n## Work\n\n## Personal\n' : template(path), { fresh: true })
      status(draft ? 'Unsaved' : 'New page', 'quiet')
      if (draft) schedule()
      return
    }
    adopt(remote, draft)
  } catch (e) {
    fail(e)
  }
}

// Take what GitHub has, unless there's a local draft worth keeping.
function adopt(remote, draft = store.get(draftKey(doc.path))) {
  const sameBase = draft && draft.base === remote.sha
  doc.sha = remote.sha
  doc.saved = remote.text
  store.set(`cache:${doc.path}`, remote)
  if (!draft || draft.text === remote.text) {
    store.del(draftKey(doc.path))
    if (editor.text() !== remote.text) editor.load(remote.text)
    status('Saved', 'quiet')
  } else if (sameBase) {
    if (editor.text() !== draft.text) editor.load(draft.text)
    schedule(0)
  } else {
    showConflict(remote)
  }
}

function changed(text) {
  store.set(draftKey(doc.path), { text, base: doc.sha })
  if (conflict) return
  status('Editing', 'quiet')
  schedule()
}

function schedule(ms = SAVE_DELAY) {
  clearTimeout(timer)
  timer = setTimeout(save, ms)
}

async function save() {
  if (saving) return saving
  const path = doc.path
  const text = editor.text()
  if (text === doc.saved && doc.sha) { store.del(draftKey(path)); status('Saved', 'quiet'); return }
  status('Saving')
  saving = (async () => {
    try {
      const sha = await gh.put(path, text, doc.sha, `edit ${path}`)
      if (doc.path !== path) return
      doc.sha = sha
      doc.saved = text
      store.set(`cache:${path}`, { text, sha })
      const now = editor.text()
      if (now === text) { store.del(draftKey(path)); status('Saved', 'quiet') }
      else { store.set(draftKey(path), { text: now, base: sha }); schedule() }
    } catch (e) {
      if (e instanceof Conflict) {
        const remote = await gh.get(path).catch(() => null)
        if (remote) showConflict(remote)
        else fail(e)
      } else fail(e)
    } finally {
      saving = null
    }
  })()
  return saving
}

async function flush() {
  if (!doc.path || conflict) return
  clearTimeout(timer)
  if (store.get(draftKey(doc.path))) await save()
}

function showConflict(remote) {
  conflict = true
  clearTimeout(timer)
  status('Not saved', 'warn')
  banner('This page changed somewhere else while you were editing.', [
    ['Keep mine', async () => {
      conflict = false
      banner('')
      doc.sha = remote.sha
      store.set(draftKey(doc.path), { text: editor.text(), base: remote.sha })
      await save()
    }],
    ['Use the other version', () => {
      conflict = false
      banner('')
      store.set(`backup:${doc.path}`, { text: editor.text(), at: Date.now() })
      store.del(draftKey(doc.path))
      adopt(remote, null)
    }],
  ])
}

function fail(e) {
  if (e instanceof AuthError) { status('Not saved', 'warn'); banner(e.message, [['Open settings', showSettings]]); return }
  if (!navigator.onLine || e instanceof TypeError) { status('Offline, saved on this device', 'warn'); return }
  status('Not saved', 'warn')
  banner(`Couldn't reach GitHub (${e.message}). Your edits are kept on this device.`, [['Try again', () => { banner(''); save() }]])
}

// Pick up edits made elsewhere (another device, or Claude) when the app comes back into view.
async function refresh() {
  if (!gh || !doc.path || conflict || saving || store.get(draftKey(doc.path))) return
  try {
    const remote = await gh.get(doc.path)
    if (remote && remote.sha !== doc.sha) adopt(remote, null)
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh()
  else flush()
})
window.addEventListener('focus', refresh)
window.addEventListener('online', () => { if (store.get(draftKey(doc.path))) save(); else refresh() })
window.addEventListener('pagehide', () => { flush() })

// ---------- settings ----------
function showSettings() {
  const cfg = store.get('config', {})
  $('repo').value = cfg.repo || 'nohatram/todo'
  $('token').value = cfg.token || ''
  $('branch').value = cfg.branch || 'main'
  $('cancel').hidden = !cfg.token
  $('settings').hidden = false
  $('app').hidden = true
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const cfg = { repo: $('repo').value.trim(), token: $('token').value.trim(), branch: $('branch').value.trim() || 'main' }
  $('settings-error').textContent = ''
  try {
    const test = createClient(cfg)
    await test.get(HOME)
    store.set('config', cfg)
    gh = test
    $('settings').hidden = true
    $('app').hidden = false
    banner('')
    open(pathFromHash())
  } catch (err) {
    $('settings-error').textContent = err instanceof AuthError
      ? 'GitHub rejected that token. It needs read and write access to Contents on this repo.'
      : `Couldn't reach ${cfg.repo}: ${err.message}.`
  }
})
$('cancel').onclick = () => { $('settings').hidden = true; $('app').hidden = false }
$('menu').onclick = showSettings
// While Cmd/Ctrl is held, links look clickable.
const modDown = (on) => document.documentElement.classList.toggle('mod-down', on)
window.addEventListener('keydown', (e) => { if (e.key === 'Meta' || e.key === 'Control') modDown(true) })
window.addEventListener('keyup', (e) => { if (e.key === 'Meta' || e.key === 'Control') modDown(false) })
window.addEventListener('blur', () => modDown(false))
$('addimg').onclick = () => $('imgpick').click()
$('imgpick').onchange = (e) => { editor.insertImages(e.target.files); e.target.value = '' }

// ---------- light / dark ----------
// The button shows where it takes you: a moon in light mode, a sun in dark mode.
const MOON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.6 10.4A5.6 5.6 0 0 1 5.6 3.4a5.6 5.6 0 1 0 7 7Z" fill="currentColor"/></svg>'
const SUN = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><g stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></g></svg>'

function applyTheme(theme) {
  const dark = theme === 'dark'
  if (dark) document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
  $('theme').innerHTML = dark ? SUN : MOON
  $('theme').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode')
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#161616' : '#f7f7f7')
}
applyTheme((() => { try { return localStorage.getItem('theme') } catch { return null } })())
$('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  try { localStorage.setItem('theme', next) } catch {}
  applyTheme(next)
}
$('back').onclick = () => back()

// ---------- start ----------
const cfg = store.get('config')
if (LOCAL) {
  document.documentElement.classList.add('is-artifact')
  $('menu').hidden = true
  gh = createLocalClient()
  open(HOME)
} else if (cfg?.token) {
  gh = createClient(cfg)
  open(pathFromHash())
} else {
  showSettings()
}
