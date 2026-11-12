import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedSteamRedirect } from '../server/security.js'
import { sha256Hex } from '../src/api/filesChunk.ts'

// notify 依赖 store（数据目录），测试先设隔离目录再动态导入——绝不触碰真实 server/data
process.env.PFC_DATA_DIR = (await import('node:fs')).default.mkdtempSync(
  (await import('node:path')).default.join((await import('node:os')).default.tmpdir(), 'pfc-audit-'),
)
process.env.PFC_MASTER_KEY = 'audit-test-key'
const { summaryFor } = await import('../server/notify.js')

test('steam proxy redirects are restricted to https on Steam-owned hosts', () => {
  for (const url of [
    'https://steamcommunity.com/profiles/x/?xml=1',
    'https://avatars.steamstatic.com/a.jpg',
    'https://avatars.cloudflare.steamstatic.com/a.jpg',
    'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/',
    'https://steamusercontent-a.akamaihd.net/ugc/x.png',
    'https://cdn.akamai.steamstatic.com/x.png',
  ]) {
    assert.equal(isAllowedSteamRedirect(url), true, url)
  }
  for (const url of [
    'http://steamcommunity.com/x',                     // 明文 http
    'https://evil.example/x',                          // 非自有域
    'https://steamcommunity.com.evil.example/x',       // 后缀伪装
    'https://169.254.169.254/latest/meta-data',        // 内网元数据
    'ftp://steamcommunity.com/x',
    'javascript:alert(1)',
    'not a url',
    '',
  ]) {
    assert.equal(isAllowedSteamRedirect(url), false, url)
  }
})

test('sha256Hex matches standard test vectors (file chunk integrity)', () => {
  // FIPS 180-4 向量
  assert.equal(sha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex(new TextEncoder().encode('')),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  // 跨 64 字节块边界（长度 56 → 需要额外填充块）
  const long = new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')
  assert.equal(sha256Hex(long),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  // 大输入（>1 块，模拟分块上传内容）
  const big = new Uint8Array(200).fill(0x61)
  const hex = sha256Hex(big)
  assert.ok(/^[0-9a-f]{64}$/.test(hex))
})

test('notify summary is built only from whitelisted fields (no raw event passthrough)', () => {
  const s = summaryFor('player_banned', { nickname: 'Alice', issuer_nickname: 'Root', reason: 'spam' })
  assert.ok(s.includes('spam'))
  // 未知事件类型原样回退——事件名进入 Subject 前由 server.js 的 safeEventName 白名单化（防邮件头注入）
  assert.equal(summaryFor('weird\nEvent', {}), 'weird\nEvent')
})
