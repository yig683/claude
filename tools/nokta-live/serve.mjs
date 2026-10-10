// A small server for the pages in this folder.
//   - files of the repository as they are;
//   - POST /save?name=<file>: keeps a picture or a file a page made, in ./out;
//   - /mod/<path>: the mod's own TypeScript (nokta/<path>) for the browser, types removed and relative imports named with
//     their file, so the very modules the app runs can be tried in a real browser (smoke.html).
//
//   node tools/nokta-live/serve.mjs [port]      then open http://localhost:5679/tools/nokta-live/compare.html
import fs from 'node:fs'
import http from 'node:http'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const modRoot = path.join(root, 'nokta')
const outDir = path.join(here, 'out')
const port = Number(process.argv[2] ?? 5679)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/javascript',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webp': 'image/webp',
}
fs.mkdirSync(outDir, { recursive: true })

/** The mod's TypeScript as a browser module: types removed, relative imports named with their file. */
function asModule(file) {
  const plain = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip' })
  return plain.replace(/(from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+?)\2/g, (_all, head, quote, spec) => {
    const target = path.resolve(path.dirname(file), spec)
    const found = ['.ts', '.tsx', '.js'].find(ext => fs.existsSync(target + ext))
    return `${head}${quote}${spec}${found ?? ''}${quote}`
  })
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'POST' && url.pathname === '/save') {
      const name = path.basename(url.searchParams.get('name') ?? 'out.png')
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        // a data URL (a picture, a JSON file as base64) or plain base64
        const body = Buffer.concat(chunks).toString('utf8')
        const base64 = body.includes(',') ? body.slice(body.indexOf(',') + 1) : body
        fs.writeFileSync(path.join(outDir, name), Buffer.from(base64, 'base64'))
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(`saved ${name}`)
      })
      return
    }
    if (url.pathname.startsWith('/mod/')) {
      const file = path.join(modRoot, decodeURIComponent(url.pathname.slice(5)))
      if (!file.startsWith(modRoot) || !fs.existsSync(file)) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      try {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
        res.end(asModule(file))
      } catch (error) {
        res.writeHead(500)
        res.end(String(error))
      }
      return
    }
    const file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://localhost:${port}`))
