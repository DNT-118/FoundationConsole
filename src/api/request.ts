/** HTTP status survives transport translation, so denied requests are never retried. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = 45000): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(init.signal?.reason)
  if (init.signal?.aborted) abort()
  else init.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    // The deadline includes reading the body, not just receiving response headers.
    const text = await res.text()
    let data: { success?: boolean; message?: string; error?: string }
    try { data = JSON.parse(text) } catch {
      throw new ApiError(`服务端响应不是有效 JSON (HTTP ${res.status})`, res.status)
    }
    if (!data || typeof data !== 'object') throw new ApiError('服务端响应格式异常', res.status)
    if (!res.ok || data.success === false) {
      throw new ApiError(data.message || data.error || `HTTP ${res.status}`, res.status)
    }
    return data as T
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('已取消', 'AbortError')
    if (controller.signal.aborted) throw new ApiError('请求超时；控制操作的结果可能尚未返回，请核实后再试')
    if (error instanceof TypeError) throw new ApiError('无法连接平台；控制操作请核实结果后再试')
    throw error
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', abort)
  }
}
