// Stand-in for the GitHub client in the artifact build: files live in this browser's storage.
// Same shape as github.js, so the rest of the app can't tell the difference.
import seed from './seed.md?raw'

const KEY = (path) => `file:${path}`
const read = (path) => { try { return JSON.parse(localStorage.getItem(KEY(path))) } catch { return null } }
const memory = new Map() // fallback when storage is blocked or full

export function createLocalClient() {
  return {
    async get(path) {
      const file = read(path) ?? memory.get(path) ?? (path === 'todo.md' ? { text: seed, sha: 'seed' } : null)
      return file && { ...file }
    },
    async put(path, text) {
      const file = { text, sha: String(Date.now()) }
      memory.set(path, file)
      try { localStorage.setItem(KEY(path), JSON.stringify(file)) } catch {}
      return file.sha
    },
    async putFile(path, blob) {
      const dataUrl = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob) })
      memory.set(KEY(path), dataUrl)
      try { localStorage.setItem(KEY(path), dataUrl) } catch {}
    },
    async getBlob(path) {
      let dataUrl = memory.get(KEY(path))
      try { dataUrl ??= localStorage.getItem(KEY(path)) } catch {}
      return dataUrl ? (await fetch(dataUrl)).blob() : null
    },
  }
}
