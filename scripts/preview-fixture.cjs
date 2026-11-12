// Disposable UI fixture: never reads or modifies server/data, never contacts a game server.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-ui-fixture-'))
process.env.PFC_DATA_DIR = dir
process.env.PFC_MASTER_KEY = 'preview-only-master-key'
const store = require('../server/store')
const crypto = require('../server/crypto')
const { isPrivateIp, isForbiddenIp } = require('../server/security')
const address = Object.values(os.networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal && isPrivateIp(a.address) && !isForbiddenIp(a.address))?.address
if (!address) throw new Error('This UI fixture needs a local private IPv4 interface')
store.upsertUser('preview', { username: 'preview', email: 'preview@qq.com', role: 'admin', passwordHash: crypto.hashPassword('Preview-only-2026!'), createdAt: Date.now() })
store.markAdminBootstrapped()
store.saveAnnouncement({ enabled: false, popupEnabled: false })
const received = []
const game = http.createServer((req, res) => {
  let body = ''
  req.on('data', data => { body += data })
  req.on('end', () => {
    const token = req.headers.authorization
    res.setHeader('Content-Type', 'application/json')
    if (!['Bearer Preview-verify-123!', 'Bearer preview-admin', 'Bearer preview-duty'].includes(token)) { res.writeHead(401); res.end('{"success":false,"message":"fixture auth denied"}'); return }
    if (req.url === '/get_sl_data') {
      res.end(JSON.stringify({ success: true, server_name: 'PEAK 测试服务器', online: true, players: [], players_count: 0, max_players: 30, current_phase: '等待玩家', nuke_status: '未激活', round_started: false, round_duration: 0, d_count: 0, foundation_count: 0, scp_count: 0, spectator_count: 0, ping: 1, adapted_plugins: [], voice_port: 0 })); return
    }
    if (token === 'Bearer preview-duty') { res.writeHead(403); res.end('{"success":false,"message":"duty Key 未授权此操作"}'); return }
    let data = {}
    if (req.url === '/control/audit/list') data = { count: 1, entries: [{ time: new Date().toISOString(), actor: 'preview-admin', endpoint: '/control/broadcast', body: '{"message":"测试广播"}', success: true, message: '全服广播已发送' }] }
    else if (req.url === '/control/broadcast' || req.url === '/control/staffchat') {
      received.push({ path: req.url, body: JSON.parse(body) })
      fs.writeFileSync(path.join(dir, 'received.json'), JSON.stringify(received))
    } else if (req.url === '/control/plugins') data = { count: 0, plugins: [] }
    else if (req.url === '/control/logs') data = { files: [], lines: ['PEAK preview fixture ready'], total: 1 }
    else if (req.url === '/control/reports') data = []
    else if (req.url === '/control/moderation/ban_list') data = { steam: [], ip: [] }
    else if (req.url === '/control/files/list') data = { path: '', directories: [], files: [] }
    res.end(JSON.stringify({ success: true, message: '操作已完成（隔离测试）', data }))
  })
})
game.listen(0, address, () => {
  for (const [label, apiKey] of [['PEAK Admin', 'preview-admin'], ['PEAK Duty', 'preview-duty']]) store.addServer('preview', { host: address, port: game.address().port, token: 'Preview-verify-123!', apiKey, label, controlTransport: 'http', refetchInterval: 5000 })
  const child = spawn(process.execPath, [path.resolve(__dirname, '../server/server.js')], { env: { ...process.env, PORT: '4317', HOST: '127.0.0.1' }, stdio: 'inherit' })
  console.log(`UI fixture: http://127.0.0.1:4317 | preview / Preview-only-2026! | ${dir}`)
  const close = () => { child.kill(); game.close(); process.exit() }
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
  child.on('exit', () => { game.close(); process.exit() })
})
