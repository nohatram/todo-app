// Turns dist-artifact/ into one artifact page: title + inline style + body + inline module script.
import fs from 'node:fs'
const dir = 'dist-artifact'
const html = fs.readFileSync(`${dir}/index.html`, 'utf8')
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => fs.readFileSync(`${dir}/${m[1]}`, 'utf8')).join('\n')
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => fs.readFileSync(`${dir}/${m[1]}`, 'utf8')).join('\n')
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').trim()
const out = `<title>Noah's List</title>
<style>${css}</style>
${body}
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`
fs.writeFileSync(`${dir}/artifact.html`, out)
console.log(`artifact.html ${(out.length / 1024).toFixed(0)} KB`)
