import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyPublicHealth } from '../scripts/verify-public-health.mjs'

test('public probe checks the health endpoint and validates JSON, not a homepage or redirect', async () => {
  const result = await verifyPublicHealth('https://example.test/', { fetchImpl: async (url, options) => {
    assert.equal(url.href, 'https://example.test/api/health')
    assert.equal(options.redirect, 'error')
    return Response.json({ success: true, status: 'ok' })
  } })
  assert.equal(result.status, 'healthy')
  for (const response of [new Response('<html>login</html>'), Response.json({ success: false }), new Response('', { status: 302 })]) {
    await assert.rejects(verifyPublicHealth('https://example.test', { fetchImpl: async () => response }))
  }
})

test('only an explicit Cloudflare challenge can be reported separately after origin verification', async () => {
  const challenge = () => new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } })
  await assert.rejects(verifyPublicHealth('https://example.test', { fetchImpl: async () => challenge() }), /Cloudflare/)
  const result = await verifyPublicHealth('https://example.test', { fetchImpl: async () => challenge(), allowEdgeChallenge: true })
  assert.equal(result.status, 'challenged')
  await assert.rejects(verifyPublicHealth('https://example.test', {
    fetchImpl: async () => new Response('', { status: 403, headers: { server: 'cloudflare' } }), allowEdgeChallenge: true,
  }), /HTTP 403/)
})

test('transient failures retry within a bound, while persistent failures remain errors', async () => {
  let calls = 0
  const result = await verifyPublicHealth('https://example.test', { wait: async () => {}, fetchImpl: async () => {
    calls++
    if (calls === 1) throw new Error('network unavailable')
    if (calls === 2) return new Response('', { status: 503 })
    return Response.json({ success: true, status: 'ok' })
  } })
  assert.equal(result.status, 'healthy')
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(verifyPublicHealth('https://example.test', { attempts: 2, wait: async () => {}, fetchImpl: async () => {
    calls++
    return new Response('', { status: 502 })
  } }), /HTTP 502/)
  assert.equal(calls, 2)
})
