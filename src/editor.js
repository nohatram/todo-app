// CodeMirror setup: plain-text lines (list markers hidden), heading labels, a left margin with an
// "open page" arrow on the current line, and keyboard navigation.
import { EditorState, Annotation, StateField, StateEffect } from '@codemirror/state'
import {
  EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection,
  gutter, GutterMarker, highlightActiveLine, highlightActiveLineGutter,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const LIST = /^(\s*)([-*+]) /
const HEADING = /^(#{1,6}) /
const LINK = /\s*\[\[([^\]\n]+)\]\]/g
const MENTION = /@claude\b/g
// Web links: [text](url) and bare URLs. Trailing punctuation isn't part of a bare URL.
const MDLINK = /(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g
const BARE = /\bhttps?:\/\/[^\s<>()\[\]]*[^\s<>()\[\].,;:!?'"]/g
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const IMAGE = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g
// Done: a task ending in " - done" (any case) or " DONE", optionally before its [[page]] link.
// A plain lowercase " done" doesn't count, so "get it done" stays a task.
const DONE = /(?:\s+[-–—]\s*[Dd][Oo][Nn][Ee]|\s+DONE)(?=\s*(?:\[\[[^\]\n]*\]\]\s*)?$)/
const TRAILING_LINK = /\s*\[\[[^\]\n]*\]\]\s*$/

const remote = Annotation.define()
const hide = Decoration.replace({})

// ---------- what counts as a task line ----------
function frontmatterEnd(doc) {
  if (doc.lines > 1 && doc.line(1).text === '---') {
    for (let n = 2; n <= doc.lines; n++) if (doc.line(n).text === '---') return n
  }
  return 0
}
const isTask = (doc, line) => line.text.trim() !== '' && !HEADING.test(line.text) && line.number > frontmatterEnd(doc)
const isDone = (doc, line) => isTask(doc, line) && DONE.test(line.text)

// The Today section's tally: top-level tasks under "## Today", and how many are done.
function todayTally(doc) {
  let on = false, done = 0, total = 0
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n), text = line.text
    if (/^#{1,2}\s/.test(text)) { if (on) break; on = /^##\s+today\s*$/i.test(text); continue }
    if (!on || /^\s/.test(text) || !isTask(doc, line) || text.includes('![')) continue
    total++
    if (DONE.test(text)) done++
  }
  return { done, total }
}

// Mark the lines under the cursor done, or not done if they all already are.
function toggleDone(view, nums, want) {
  const doc = view.state.doc
  const lines = nums.map((n) => doc.line(n)).filter((l) => isTask(doc, l))
  if (!lines.length) return false
  if (want === undefined) want = !lines.every((l) => DONE.test(l.text))
  const changes = []
  for (const l of lines) {
    const m = DONE.exec(l.text)
    if (!want && m) changes.push({ from: l.from + m.index, to: l.from + m.index + m[0].length })
    if (want && !m) {
      const link = TRAILING_LINK.exec(l.text)
      const end = link ? link.index : l.text.trimEnd().length
      changes.push({ from: l.from + end, insert: ' - DONE' })
    }
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'input.done' })
  return true
}
const selectedLines = (state) => {
  const nums = new Set()
  for (const r of state.selection.ranges) for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) nums.add(n)
  return [...nums]
}
const linkOf = (text) => /\[\[([^\]\n]+)\]\]/.exec(text)?.[1].trim()

function slugFor(text) {
  const words = text.replace(LIST, '').replace(MENTION, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  return words.slice(0, 4).join('-') || 'task'
}

// ---------- widgets ----------
class DateWidget extends WidgetType {
  constructor(tally) { super(); this.tally = tally }
  eq(o) { return o.tally.done === this.tally.done && o.tally.total === this.tally.total }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-today-date'
    s.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    if (this.tally.total) {
      const c = document.createElement('span')
      c.className = 'cm-today-tally'
      c.textContent = `${this.tally.done}/${this.tally.total} done`
      s.append(c)
    }
    return s
  }
}
// In place of the " - DONE" text, a small check (the text comes back while you're on that line).
class CheckWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-done-check'
    s.textContent = '✓'
    s.setAttribute('aria-label', 'done')
    return s
  }
}
const checkWidget = new CheckWidget()

// ---------- images ----------
// Each image line gets the picture drawn below it. Block widgets have to come from a state field.
let resolveImage = async (src) => src
class ImageWidget extends WidgetType {
  constructor(src, alt) { super(); this.src = src; this.alt = alt }
  eq(o) { return o.src === this.src }
  get estimatedHeight() { return 240 }
  toDOM(view) {
    const box = document.createElement('div')
    box.className = 'cm-img'
    const img = document.createElement('img')
    img.alt = this.alt || ''
    img.onload = () => view.requestMeasure()
    resolveImage(this.src).then((u) => { img.src = u }).catch(() => {
      box.classList.add('is-missing')
      box.textContent = `image not found: ${this.src}`
    })
    box.append(img)
    return box
  }
  ignoreEvent() { return false }
}
function imageBlocks(state) {
  const decos = []
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.includes('![')) continue
    for (const m of line.text.matchAll(IMAGE)) decos.push(Decoration.widget({ widget: new ImageWidget(m[2], m[1]), block: true, side: 1 }).range(line.to))
  }
  return Decoration.set(decos, true)
}
const images = StateField.define({
  create: imageBlocks,
  update: (value, tr) => (tr.docChanged ? imageBlocks(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
})

// ---------- live preview ----------
function build(view, fresh = []) {
  const decos = []
  const { state } = view
  const doc = state.doc
  const tally = todayTally(doc)
  const active = new Set()
  if (view.hasFocus) for (const r of state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) active.add(n)
  }
  const fmEnd = frontmatterEnd(doc)

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos)
      const text = line.text
      const editing = active.has(line.number)

      if (line.number <= fmEnd) {
        decos.push(Decoration.line({ class: 'cm-fm' }).range(line.from))
      } else {
        const h = HEADING.exec(text)
        if (h) {
          decos.push(Decoration.line({ class: `cm-h cm-h${h[1].length}` }).range(line.from))
          if (!editing) decos.push(hide.range(line.from, line.from + h[0].length))
          if (line.to > line.from + h[0].length) decos.push(Decoration.mark({ class: 'cm-h-text' }).range(line.from + h[0].length, line.to))
          if (/^##\s+today\s*$/i.test(text)) decos.push(Decoration.widget({ widget: new DateWidget(tally), side: 1 }).range(line.to))
        }
        const m = LIST.exec(text)
        if (m) {
          // No bullets: the marker is hidden and nesting shows as indent.
          const level = Math.floor(m[1].replace(/\t/g, '  ').length / 2)
          decos.push(Decoration.line({ class: level ? 'cm-item cm-sub' : 'cm-item', attributes: { style: `padding-left: ${level * 2}ch` } }).range(line.from))
          decos.push(hide.range(line.from, line.from + m[0].length))
        }
        for (const l of text.matchAll(LINK)) {
          const a = line.from + l.index
          const b = a + l[0].length
          // Page links stay out of the way; the margin shows which lines have a page.
          decos.push(editing ? Decoration.mark({ class: 'cm-link-raw' }).range(a, b) : hide.range(a, b))
        }
        const taken = []
        for (const l of text.matchAll(MDLINK)) {
          const a = line.from + l.index, t0 = a + 1, t1 = t0 + l[1].length, b = a + l[0].length
          taken.push([l.index, l.index + l[0].length])
          const mark = Decoration.mark({ class: 'cm-url', attributes: { 'data-href': l[2] } })
          if (editing) decos.push(mark.range(a, b))
          else decos.push(hide.range(a, t0), mark.range(t0, t1), hide.range(t1, b))
        }
        for (const u of text.matchAll(BARE)) {
          if (taken.some(([x, y]) => u.index >= x && u.index < y) || text.slice(Math.max(0, u.index - 2), u.index) === '](') continue
          const a = line.from + u.index, b = a + u[0].length
          decos.push(Decoration.mark({ class: 'cm-url', attributes: { 'data-href': u[0] } }).range(a, b))
        }
        for (const im of text.matchAll(IMAGE)) {
          // The picture shows below the line; its markdown only shows while you're on that line.
          const a = line.from + im.index
          decos.push(editing ? Decoration.mark({ class: 'cm-imgsrc' }).range(a, a + im[0].length) : hide.range(a, a + im[0].length))
        }
        const d = !h && isTask(doc, line) && DONE.exec(text)
        if (d) {
          // just finished: the highlight sweeps across the row(s) before the line fades
          const isNew = fresh.some((f) => f >= line.from && f <= line.to)
          decos.push(Decoration.line({ class: isNew ? 'cm-done cm-done-new' : 'cm-done' }).range(line.from))
          const a = line.from + d.index
          decos.push(editing ? Decoration.mark({ class: 'cm-done-raw' }).range(a, a + d[0].length) : Decoration.replace({ widget: checkWidget }).range(a, a + d[0].length))
        }
        for (const c of text.matchAll(MENTION)) {
          decos.push(Decoration.mark({ class: 'cm-claude' }).range(line.from + c.index, line.from + c.index + c[0].length))
        }
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(decos, true)
}

// Lines that just became done (by typing, Cmd/Ctrl+D or a swipe) get the sweep once; the class
// comes off when it's over, so a redrawn line doesn't play it again. Loads from GitHub never animate.
const sweepDone = StateEffect.define()
const SWEEP_MS = 1300
const preview = ViewPlugin.fromClass(
  class {
    constructor(view) { this.fresh = []; this.decorations = build(view) }
    update(u) {
      let changed = false
      if (u.docChanged) {
        this.fresh = this.fresh.map((p) => u.changes.mapPos(p))
        if (!u.transactions.some((tr) => tr.annotation(remote))) {
          const before = u.startState.doc, after = u.state.doc
          u.changes.iterChangedRanges((fa, ta, fb, tb) => {
            for (let n = after.lineAt(fb).number; n <= after.lineAt(tb).number; n++) {
              const line = after.line(n)
              if (!isDone(after, line)) continue
              const old = before.lineAt(Math.min(u.changes.invertedDesc.mapPos(line.from, 1), before.length))
              if (isDone(before, old)) continue
              this.fresh.push(line.from)
              changed = true
              setTimeout(() => u.view.dispatch({ effects: sweepDone.of(null) }), SWEEP_MS)
            }
          })
        }
      }
      if (u.transactions.some((tr) => tr.effects.some((e) => e.is(sweepDone)))) { this.fresh.shift(); changed = true }
      if (changed || u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = build(u.view, this.fresh)
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
  },
)

// ---------- swipe a line on a phone: right for done, left for not done ----------
const swipe = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view; this.s = null
    const dom = view.contentDOM
    this.start = (e) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0], pos = view.posAtCoords({ x: t.clientX, y: t.clientY })
      if (pos == null) return
      const line = view.state.doc.lineAt(pos)
      if (!isTask(view.state.doc, line)) return
      const el = view.domAtPos(line.from).node
      this.s = { x: t.clientX, y: t.clientY, n: line.number, el: (el.nodeType === 1 ? el : el.parentElement)?.closest('.cm-line'), dx: 0, on: false }
    }
    this.move = (e) => {
      const s = this.s
      if (!s || !s.el) return
      const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y
      if (!s.on) {
        if (Math.abs(dy) > 10) { this.s = null; return }   // it's a scroll
        if (Math.abs(dx) < 12) return
        s.on = true
      }
      s.dx = dx
      s.el.style.transform = `translateX(${Math.max(-60, Math.min(60, dx * .5)).toFixed(1)}px)`
    }
    this.end = () => {
      const s = this.s
      this.s = null
      if (!s || !s.on) return
      if (s.el) { s.el.style.transition = 'transform .2s ease'; s.el.style.transform = ''; setTimeout(() => { if (s.el) s.el.style.transition = '' }, 220) }
      if (s.dx > 70) toggleDone(view, [s.n], true)
      if (s.dx < -70) toggleDone(view, [s.n], false)
    }
    dom.addEventListener('touchstart', this.start, { passive: true })
    dom.addEventListener('touchmove', this.move, { passive: true })
    dom.addEventListener('touchend', this.end)
    dom.addEventListener('touchcancel', this.end)
  }
  destroy() {
    const dom = this.view.contentDOM
    dom.removeEventListener('touchstart', this.start); dom.removeEventListener('touchmove', this.move)
    dom.removeEventListener('touchend', this.end); dom.removeEventListener('touchcancel', this.end)
  }
})

// ---------- left margin: open-page arrow ----------
class Marker extends GutterMarker {
  constructor(kind) { super(); this.kind = kind }
  eq(o) { return o.kind === this.kind }
  toDOM() {
    const s = document.createElement('span')
    s.className = `cm-open cm-open-${this.kind}`
    s.textContent = this.kind === 'open' ? '→' : '·'
    if (this.kind === 'open') s.title = 'Open this task’s page (⌘↵)'
    return s
  }
}
const openMarker = new Marker('open')
const hasMarker = new Marker('has')

function margin(openLine) {
  return gutter({
    class: 'cm-task-gutter',
    lineMarker(view, block) {
      const doc = view.state.doc
      const line = doc.lineAt(block.from)
      if (!isTask(doc, line)) return null
      if (view.hasFocus && doc.lineAt(view.state.selection.main.head).number === line.number) return openMarker
      return linkOf(line.text) ? hasMarker : null
    },
    lineMarkerChange: (u) => u.selectionSet || u.docChanged || u.focusChanged,
    initialSpacer: () => openMarker,
    domEventHandlers: {
      mousedown(view, block, e) {
        if (!e.target.closest?.('.cm-open')) return false
        e.preventDefault()
        openLine(view, view.state.doc.lineAt(block.from))
        return true
      },
    },
  })
}

// ---------- look ----------
const highlight = HighlightStyle.define([
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: [t.link, t.url], color: 'var(--muted)', textDecoration: 'underline' },
  { tag: t.processingInstruction, color: 'var(--faint)' },
])

// Overrides CodeMirror's base theme, which outranks plain CSS.
const layout = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: 'var(--row)', paddingInline: 'var(--colpad)', overflow: 'visible' },
  '.cm-content': { padding: 'var(--row) 0 40vh', maxWidth: 'calc(var(--measure) - 2ch)', caretColor: 'var(--caret)' },
  '.cm-line': { padding: '0 1ch 0 0' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--faint)' },
  '.cm-task-gutter .cm-gutterElement': { width: '2ch', textAlign: 'center', padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--caret)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--select)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  // the band steps aside while text is selected, so the selection stays visible on that line
  '&.cm-focused:not(.cm-has-selection) .cm-activeLine, &.cm-focused .cm-activeLineGutter': { backgroundColor: 'var(--band)' },
})

export function createEditor(parent, { onChange, onLink, onBack, onImage, loadImage }) {
  if (loadImage) resolveImage = loadImage
  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: extensions() }) })

  // Open a line's page, giving it one first if it doesn't have a link yet.
  function openLine(v, line) {
    if (!isTask(v.state.doc, line)) return false
    let slug = linkOf(line.text)
    if (!slug) {
      slug = slugFor(line.text)
      v.dispatch({ changes: { from: line.to, insert: `${/\s$/.test(line.text) ? '' : ' '}[[${slug}]]` } })
    }
    onLink(slug, areaAt(v, line.from))
    return true
  }

  // Put each image on its own line at the cursor (or where it was dropped), then save it in the background.
  async function insertImages(files, at) {
    for (const file of files) {
      const src = await onImage(file)
      if (!src) continue
      const st = view.state
      const pos = at ?? st.selection.main.head
      const line = st.doc.lineAt(pos)
      const md = `![](${src})`
      const insert = line.text.trim() === '' ? md : `\n${md}`
      const from = line.text.trim() === '' ? line.from : line.to
      view.dispatch({ changes: { from, to: line.text.trim() === '' ? line.to : from, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true })
      at = undefined
    }
  }
  const imageFiles = (list) => [...(list || [])].filter((f) => f.type.startsWith('image/'))

  function extensions() {
    return [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      layout,
      margin(openLine),
      highlightActiveLine(),
      EditorView.editorAttributes.compute(['selection'], (st) => (st.selection.main.empty ? {} : { class: 'cm-has-selection' })),
      highlightActiveLineGutter(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      preview,
      images,
      swipe,
      EditorView.domEventHandlers({
        // Cmd/Ctrl-click opens a link in a new tab; on a phone a tap does, since there's no Cmd key.
        mousedown(e) {
          const el = e.target.closest?.('[data-href]')
          if (!el || !(e.metaKey || e.ctrlKey || coarse)) return false
          e.preventDefault()
          window.open(el.dataset.href, '_blank', 'noopener')
          return true
        },
        paste(e) {
          const files = imageFiles(e.clipboardData?.files)
          if (!files.length || !onImage) return false
          e.preventDefault()
          insertImages(files)
          return true
        },
        drop(e, v) {
          const files = imageFiles(e.dataTransfer?.files)
          if (!files.length || !onImage) return false
          e.preventDefault()
          insertImages(files, v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined)
          return true
        },
      }),
      keymap.of([
        { key: 'Mod-Enter', run: (v) => openLine(v, v.state.doc.lineAt(v.state.selection.main.head)) },
        // done / not done (takes over the browser's bookmark shortcut while you're in the list)
        { key: 'Mod-d', preventDefault: true, run: (v) => { toggleDone(v, selectedLines(v.state)); return true } },
        { key: 'Escape', run: () => onBack() },
        ...defaultKeymap, ...historyKeymap, indentWithTab,
      ]),
      // Typing "[[" closes it to "[[]]" with the cursor in the middle, like Obsidian.
      EditorView.inputHandler.of((v, from, to, text) => {
        if (text !== '[' || v.state.doc.sliceString(from - 1, from) !== '[') return false
        v.dispatch({ changes: { from, to, insert: '[]]' }, selection: { anchor: from + 1 } })
        return true
      }),
      EditorView.contentAttributes.of({ autocapitalize: 'off', spellcheck: 'true', 'aria-label': 'List' }),
      EditorView.updateListener.of((u) => { if (u.docChanged && !u.transactions.some((tr) => tr.annotation(remote))) onChange(view.state.doc.toString()) }),
    ]
  }

  return {
    view,
    // Replace the whole doc without triggering a save; keeps the cursor and scroll close to where they were.
    load(text, { fresh = false } = {}) {
      if (fresh) {
        view.setState(EditorState.create({ doc: text, extensions: extensions() }))
        return
      }
      const head = Math.min(view.state.selection.main.head, text.length)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head }, annotations: remote.of(true) })
    },
    text: () => view.state.doc.toString(),
    insertImages: (files) => insertImages(imageFiles(files)),
    place(pos, focus) {
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: focus })
      if (focus) view.focus()
    },
  }
}

// Which section a position sits in, so new task pages can be tagged work or personal.
function areaAt(view, pos) {
  const doc = view.state.doc
  for (let n = doc.lineAt(pos).number; n >= 1; n--) {
    const s = doc.line(n).text
    if (/^#{2,3}\s+work\b/i.test(s)) return 'work'
    if (/^#{2,3}\s+personal\b/i.test(s)) return 'personal'
  }
  return ''
}
