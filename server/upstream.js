const http = require('node:http')

/** Bounded, single-attempt upstream request. Never return truncated data as a success. */
function requestUpstream(server, ip, method, path, body, { timeoutMs = 25000, maxBytes = 4 * 1024 * 1024 } = {}) {
  const headers = { Accept: 'application/json', Host: `${server.host}:${server.port}` }
  const credential = method === 'GET' ? server.token : server.apiKey
  if (!credential) return Promise.resolve({ ok: false, status: 403, message: method === 'GET' ? '未配置 VerifyToken' : '未配置 API Key' })
  headers.Authorization = `Bearer ${credential}`
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(body || '')
  }
  return new Promise((resolve) => {
    let req, timer, settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const fail = (message) => done({ ok: false, status: 502, message })
    try {
      req = http.request({ host: ip, port: server.port, path, method, headers }, (res) => {
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size > maxBytes) {
            fail('上游响应超过大小限制')
            res.destroy()
            req.destroy()
          } else chunks.push(chunk)
        })
        res.on('aborted', () => fail('上游响应中断，请核实操作结果'))
        res.on('error', () => fail('上游响应读取失败'))
        res.on('end', () => {
          const status = res.statusCode || 502
          let data
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return fail(`上游响应不是有效 JSON (HTTP ${status})`) }
          if (!data || typeof data !== 'object') return fail('上游响应格式异常')
          done({ ok: status >= 200 && status < 300 && data.success !== false, status, data, message: data.message })
        })
      })
      req.on('error', () => fail('上游连接失败，请核实操作结果后再试'))
      timer = setTimeout(() => { done({ ok: false, status: 504, message: '上游超时，请核实操作结果后再试' }); req.destroy() }, timeoutMs)
      req.end(body)
    } catch { fail('上游请求配置无效') }
  })
}
module.exports = { requestUpstream }
