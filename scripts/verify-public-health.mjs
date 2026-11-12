import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// A Cloudflare challenge is not an application response. Only the deployment
// workflow, after its mandatory origin health check, may allow this result.
export async function verifyPublicHealth(baseUrl, {
  fetchImpl = fetch, wait = delay, attempts = 6, allowEdgeChallenge = false,
} = {}) {
  const url = new URL('/api/health', baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Health URL must use HTTP(S)')
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response
    try {
      response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        redirect: 'error', signal: AbortSignal.timeout(20_000),
      })
      // https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/
      if (response.headers.get('cf-mitigated') === 'challenge') {
        await response.body?.cancel()
        if (allowEdgeChallenge) return { status: 'challenged' }
        throw new Error('Cloudflare challenge prevented public health verification')
      }
      if (response.status === 200) {
        const body = await response.json()
        if (body?.success === true && body?.status === 'ok') return { status: 'healthy' }
        throw new Error('Public health response does not match the application contract')
      }
      await response.body?.cancel()
    } catch (error) {
      if (response || attempt === attempts) throw error
      await wait(3000)
      continue
    }
    if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
      await wait(3000)
      continue
    }
    throw new Error(`Public health check failed: HTTP ${response.status}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyPublicHealth(process.argv[2], {
      allowEdgeChallenge: process.argv.includes('--allow-edge-challenge'),
    })
    const message = result.status === 'healthy'
      ? 'Public /api/health verified: HTTP 200 and valid application JSON.'
      : 'Origin deployment and health check passed; Cloudflare challenged this runner. Public application health remains unverified from this runner.'
    console.log(result.status === 'challenged' ? `::warning::${message}` : message)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`)
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}
