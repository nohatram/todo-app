// Stand-in for the GitHub client in the artifact build: files live in this browser's storage.
// Same get/put shape, so the rest of the app can't tell the difference.
import seed from './seed.md?raw'

const KEY = (path) => `file:${path}`
const read = (path) => { try { return JSON.parse(localStorage.getItem(KEY(path))) } catch { return null } }
const memory = new Map() // fallback when storage is blocked

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
  }
}
