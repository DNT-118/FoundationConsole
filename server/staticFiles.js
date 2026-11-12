const fs = require('node:fs')
const { stat, realpath } = require('node:fs/promises')
const path = require('node:path')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg' }

async function serveStatic(req, res, root, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { res.writeHead(400); res.end(); return }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) { res.writeHead(400); res.end(); return }
  let file = path.resolve(root, '.' + decoded)
  let info
  try { info = await stat(file); if (!info.isFile()) throw new Error('not a file') } catch {
    // Missing assets must return 404, not index.html (which breaks cached lazy imports).
    if (path.extname(decoded) || decoded.startsWith('/assets/')) { res.writeHead(404); res.end('not found'); return }
    file = path.join(root, 'index.html')
    try { info = await stat(file) } catch { res.writeHead(404); res.end('Build the frontend first'); return }
  }
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)])
  if (!realFile.startsWith(realRoot + path.sep)) { res.writeHead(403); res.end(); return }
  const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`
  const hashed = path.basename(file).match(/-[\w-]{8,}\.(js|css|woff2)$/)
  res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.setHeader('ETag', etag)
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
  res.setHeader('Accept-Ranges', 'bytes')
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return }
  let start = 0, end = info.size - 1, status = 200
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]))
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
      status = 206
    }
    if (status !== 206 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return
    }
    res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
  }
  res.setHeader('Content-Length', Math.max(0, end - start + 1))
  res.writeHead(status)
  if (req.method === 'HEAD' || info.size === 0) { res.end(); return }
  const stream = fs.createReadStream(file, { start, end })
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}
module.exports = { serveStatic }
