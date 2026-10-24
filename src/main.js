import './style.css'
import { createClient, Conflict, AuthError } from './github.js'
import { createEditor } from './editor.js'

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

const editor = createEditor($('editor'), { onChange: changed, onLink: openTask })

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

function openTask(slug, area) {
  const path = `tasks/${slugify(slug)}.md`
  store.set(`area:${path}`, area)
  location.hash = `/${path}`
}

window.addEventListener('hashchange', () => open(pathFromHash()))

// ---------- load + save ----------
const draftKey = (p) => `draft:${p}`

function template(path) {
  const area = store.get(`area:${path}`, '')
  return `---\narea: ${area}\nstatus: open\n---\n# ${titleOf(path)}\n\n## Notes\n\n\n## Claude\n`
}

async function open(path) {
  await flush()
  clearTimeout(timer)
  conflict = false
  banner('')
  $('back').hidden = path === HOME
  document.body.classList.toggle('is-task', path !== HOME)
  $('title').textContent = titleOf(path)
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
$('back').onclick = () => { location.hash = '' }
$('title').onclick = () => editor.view.scrollDOM.scrollTo({ top: 0, behavior: 'smooth' })

// ---------- start ----------
const cfg = store.get('config')
if (cfg?.token) {
  gh = createClient(cfg)
  open(pathFromHash())
} else {
  showSettings()
}
