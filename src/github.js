// Minimal GitHub contents API client. One file at a time, optimistic concurrency via sha.

const API = 'https://api.github.com'

export class Conflict extends Error {}
export class AuthError extends Error {}

const enc = (text) => {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)))

export function createClient({ repo, token, branch = 'main', api = API }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const url = (path) => `${api}/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`

  async function check(res) {
    if (res.status === 401 || res.status === 403) throw new AuthError(`GitHub said ${res.status}. Check the token in Settings.`)
    if (res.status === 409 || res.status === 422) throw new Conflict()
    if (!res.ok) throw new Error(`GitHub said ${res.status}`)
    return res.json()
  }

  return {
    async get(path) {
      const res = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, { headers, cache: 'no-store' })
      if (res.status === 404) return null
      const json = await check(res)
      return { text: dec(json.content), sha: json.sha }
    },
    async put(path, text, sha, message) {
      const body = { message, content: enc(text), branch }
      if (sha) body.sha = sha
      const res = await fetch(url(path), { method: 'PUT', headers, body: JSON.stringify(body) })
      const json = await check(res)
      return json.content.sha
    },
  }
}
