// CodeMirror setup with a light "live preview": headings, tappable checkboxes, [[task]] links, @claude tags.
import { EditorState, Annotation } from '@codemirror/state'
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const TASK = /^(\s*)([-*+]) \[( |x|X)\] /
const HEADING = /^(#{1,6}) /
const LINK = /\[\[([^\]\n]+)\]\]/g
const MENTION = /@claude\b/g

class CheckWidget extends WidgetType {
  constructor(done) { super(); this.done = done }
  eq(o) { return o.done === this.done }
  toDOM(view) {
    const b = document.createElement('button')
    b.className = 'cm-check' + (this.done ? ' is-done' : '')
    b.setAttribute('aria-label', this.done ? 'Mark not done' : 'Mark done')
    b.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1.5" y="1.5" width="17" height="17" rx="5"/><path d="M5.5 10.5l3 3 6-7"/></svg>'
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      const at = view.posAtDOM(b) + 3 // "- [" then the box character
      const ch = view.state.doc.sliceString(at, at + 1)
      b.classList.add('just-toggled')
      view.dispatch({ changes: { from: at, to: at + 1, insert: ch === ' ' ? 'x' : ' ' } })
    })
    return b
  }
  ignoreEvent() { return true }
}

class DateWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-today-date'
    s.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    return s
  }
}

const hide = Decoration.replace({})
const remote = Annotation.define()

function build(view) {
  const decos = []
  const { state } = view
  const doc = state.doc
  const active = new Set()
  if (view.hasFocus) for (const r of state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) active.add(n)
  }

  // Frontmatter block at the top of task pages
  let fmEnd = 0
  if (doc.lines > 1 && doc.line(1).text === '---') {
    for (let n = 2; n <= doc.lines; n++) if (doc.line(n).text === '---') { fmEnd = n; break }
  }

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
          if (/^##\s+today\s*$/i.test(text)) decos.push(Decoration.widget({ widget: new DateWidget(), side: 1 }).range(line.to))
        }
        const m = TASK.exec(text)
        if (m) {
          const done = m[3] !== ' '
          const start = line.from + m[1].length
          decos.push(Decoration.line({ class: 'cm-task' + (done ? ' cm-done' : '') }).range(line.from))
          decos.push(Decoration.replace({ widget: new CheckWidget(done) }).range(start, line.from + m[0].length))
        } else if (/^\s*[-*+] /.test(text)) {
          decos.push(Decoration.line({ class: 'cm-bullet' }).range(line.from))
        }
        for (const l of text.matchAll(LINK)) {
          const a = line.from + l.index
          const b = a + l[0].length
          const slug = l[1].trim()
          if (!editing) decos.push(hide.range(a, a + 2))
          decos.push(Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-slug': slug } }).range(a + 2, b - 2))
          if (!editing) decos.push(hide.range(b - 2, b))
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

const highlight = HighlightStyle.define([
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em' },
  { tag: [t.link, t.url], color: 'var(--pen)' },
  { tag: t.processingInstruction, color: 'var(--muted)' },
])

// Overrides CodeMirror's base theme, which outranks plain CSS.
const layout = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font)', lineHeight: '1.55' },
  '.cm-content': { width: '100%', maxWidth: 'calc(var(--measure) + 2 * var(--gutter))', margin: '0 auto', padding: '8px var(--gutter) 40vh', caretColor: 'var(--pen)' },
  '.cm-line': { padding: '1px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--pen)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--pen-wash)' },
})

export function createEditor(parent, { onChange, onLink }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: '', extensions: extensions() }),
  })

  function extensions() {
    return [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      layout,
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      preview,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.contentAttributes.of({ autocapitalize: 'sentences', spellcheck: 'true', 'aria-label': 'List' }),
      EditorView.updateListener.of((u) => { if (u.docChanged && !u.transactions.some((tr) => tr.annotation(remote))) onChange(view.state.doc.toString()) }),
      EditorView.domEventHandlers({
        mousedown(e, v) {
          const el = e.target.closest?.('.cm-wikilink')
          if (!el) return false
          e.preventDefault()
          onLink(el.dataset.slug, areaAt(v, v.posAtDOM(el)))
          return true
        },
      }),
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
      const top = view.scrollDOM.scrollTop
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head }, annotations: remote.of(true) })
      view.scrollDOM.scrollTop = top
    },
    text: () => view.state.doc.toString(),
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
