// CodeMirror setup: plain-text lines (list markers hidden), heading labels, a left margin with an
// "open page" arrow on the current line, and keyboard navigation.
import { EditorState, Annotation, StateField } from '@codemirror/state'
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
const linkOf = (text) => /\[\[([^\]\n]+)\]\]/.exec(text)?.[1].trim()

function slugFor(text) {
  const words = text.replace(LIST, '').replace(MENTION, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  return words.slice(0, 4).join('-') || 'task'
}

// ---------- widgets ----------
class DateWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-today-date'
    s.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    return s
  }
}

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

// A long bare URL, shown short while you're not on its line.
class UrlWidget extends WidgetType {
  constructor(href) { super(); this.href = href }
  eq(o) { return o.href === this.href }
  toDOM() {
    const a = document.createElement('span')
    a.className = 'cm-url'
    a.dataset.href = this.href
    a.title = coarse ? this.href : `${this.href}  (⌘-click to open)`
    try {
      const u = new URL(this.href)
      const first = u.pathname.split('/').filter(Boolean)[0]
      const more = u.pathname.split('/').filter(Boolean).length > 1 || u.search
      a.textContent = u.host.replace(/^www\./, '') + (first ? `/${first}` : '') + (more ? '/…' : '')
    } catch { a.textContent = this.href }
    return a
  }
  ignoreEvent() { return false }
}

// ---------- live preview ----------
function build(view) {
  const decos = []
  const { state } = view
  const doc = state.doc
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
          if (/^##\s+today\s*$/i.test(text)) decos.push(Decoration.widget({ widget: new DateWidget(), side: 1 }).range(line.to))
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
          decos.push(editing
            ? Decoration.mark({ class: 'cm-url', attributes: { 'data-href': u[0] } }).range(a, b)
            : Decoration.replace({ widget: new UrlWidget(u[0]) }).range(a, b))
        }
        for (const im of text.matchAll(IMAGE)) {
          // The picture shows below the line; its markdown only shows while you're on that line.
          const a = line.from + im.index
          decos.push(editing ? Decoration.mark({ class: 'cm-imgsrc' }).range(a, a + im[0].length) : hide.range(a, a + im[0].length))
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

const preview = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = build(view) }
    update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = build(u.view) }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
  },
)

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
