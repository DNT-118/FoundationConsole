/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * [内测 beta_file_root_ws] 文件分块读写（严格对齐 SLDataAPI FileService/FileUploadSessions 契约）：
 *  - read_chunk：{path, offset, length≤160KB} → {data(base64), next_offset, eof, sha256(offset=0 时为整文件)}；
 *    文件 ≤1MB（上游 MaxReadBytes）。
 *  - write_chunk：append（新会话不带 upload_id 且 offset=0）→ {upload_id, received, committed:false}；
 *    终块 final:true + 可选 sha256 → {committed:true, file:{path, bytes, sha256}}；
 *    abort → {aborted}。会话 120s 空闲过期、offset 必须严格连续、总大小 ≤512KB、内容必须 UTF-8 文本。
 *  - HTTP /control 请求体上限 64KB：原始块取 32KB（base64 ≈43KB + 信封 <64KB），
 *    WS 单消息 256KB 同样满足。
 * SHA-256 用内置纯 JS 实现：页在明文 HTTP（局域网直连）下 crypto.subtle 不可用。
 */
import type { ControlResult } from '@/types/api'
import type { FileReadChunkResult, FileWriteChunkResult } from '@/types/api'

type Control = (path: string, body?: unknown) => Promise<ControlResult>

export class ChunkCancelled extends Error {
  constructor() {
    super('chunk transfer cancelled')
    this.name = 'ChunkCancelled'
  }
}

export const FILE_MAX_WRITE_BYTES = 512 * 1024   // 上游 MaxWriteBytes
export const FILE_MAX_READ_BYTES = 1024 * 1024   // 上游 MaxReadBytes
const READ_CHUNK_BYTES = 64 * 1024               // 上游 DefaultChunkBytes（上限 160KB）
const WRITE_CHUNK_BYTES = 32 * 1024              // 控制面 64KB 请求体限内的安全块大小

// ---------- SHA-256（纯 JS，hex 输出） ----------

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/** SHA-256 → hex（同步，≤2MB 文件性能足够）。 */
export function sha256Hex(bytes: Uint8Array): string {
  const l = bytes.length
  const bitLenHi = Math.floor(l / 0x20000000)
  const bitLenLo = (l << 3) >>> 0
  const withOne = l + 1
  const padded = (withOne + 9 + 63) & ~63
  const buf = new Uint8Array(padded)
  buf.set(bytes)
  buf[l] = 0x80
  const dv = new DataView(buf.buffer)
  dv.setUint32(padded - 8, bitLenHi)
  dv.setUint32(padded - 4, bitLenLo)

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Int32Array(64)

  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export interface ChunkHooks {
  /** 进度回调（字节）。 */
  onProgress?: (done: number, total: number) => void
  /** 返回 true 时中止（读取直接失败；写入会先向上游发送 abort 再失败）。 */
  shouldCancel?: () => boolean
}

/** 分块读取整文件并拼接为文本；校验 offset=0 帧附带的整文件 sha256。 */
export async function chunkedRead(
  control: Control,
  path: string,
  hooks?: ChunkHooks,
): Promise<{ text: string; size: number; sha256: string | null }> {
  const chunks: Uint8Array[] = []
  let size = 0
  let sha: string | null = null
  let offset = 0
  for (;;) {
    if (hooks?.shouldCancel?.()) throw new ChunkCancelled()
    const r = await control('/control/files/read_chunk', { path, offset, length: READ_CHUNK_BYTES })
    const data = r.data as unknown as FileReadChunkResult
    const bytes = base64ToBytes(data.data)
    if (bytes.length !== data.length) throw new Error('分块读取：返回长度与 data 不一致')
    if (data.offset !== offset) throw new Error(`分块读取：offset 不连续（期望 ${offset}，收到 ${data.offset}）`)
    if (data.offset === 0 && typeof data.sha256 === 'string') sha = data.sha256
    chunks.push(bytes)
    size += bytes.length
    if (size > FILE_MAX_READ_BYTES) throw new Error(`文件超过分块读取上限（${FILE_MAX_READ_BYTES} 字节）`)
    hooks?.onProgress?.(size, data.size)
    if (data.eof) break
    offset = data.next_offset
  }
  const all = new Uint8Array(size)
  let pos = 0
  for (const c of chunks) { all.set(c, pos); pos += c.length }
  if (sha) {
    const local = sha256Hex(all)
    if (local !== sha.toLowerCase()) throw new Error('sha256 校验失败：下载内容与上游声明不一致')
  }
  // 上游要求文本（UTF-8）
  const text = new TextDecoder('utf-8', { fatal: true }).decode(all)
  return { text, size, sha256: sha }
}

/** 分块上传文本内容（UTF-8，≤512KB）；终块带整内容 sha256 做端到端校验，返回上传摘要。 */
export async function chunkedWrite(
  control: Control,
  path: string,
  text: string,
  hooks?: ChunkHooks,
): Promise<{ bytes: number; sha256: string }> {
  const all = new TextEncoder().encode(text)
  if (all.length > FILE_MAX_WRITE_BYTES) {
    throw new Error(`内容超过分块上传上限（${all.length} > ${FILE_MAX_WRITE_BYTES} 字节）`)
  }
  const expectedSha = sha256Hex(all)
  let uploadId = ''
  let sent = 0
  const abort = async () => {
    if (uploadId) {
      try { await control('/control/files/write_chunk', { path, action: 'abort', upload_id: uploadId }) } catch { /* 尽力取消 */ }
    }
  }
  try {
    for (;;) {
      if (hooks?.shouldCancel?.()) { await abort(); throw new ChunkCancelled() }
      const start = sent
      const end = Math.min(all.length, start + WRITE_CHUNK_BYTES)
      const chunk = all.subarray(start, end)
      const isFinal = end >= all.length
      const body: Record<string, unknown> = {
        path,
        action: 'append',
        offset: start,
        data: bytesToBase64(chunk),
        final: isFinal,
      }
      if (uploadId) body.upload_id = uploadId
      if (isFinal) body.sha256 = expectedSha
      const r = await control('/control/files/write_chunk', body)
      const data = r.data as unknown as FileWriteChunkResult
      if (uploadId && data.upload_id && data.upload_id !== uploadId) {
        throw new Error('分块上传：upload_id 与会话不一致')
      }
      uploadId = data.upload_id ?? uploadId
      sent = data.received ?? end
      hooks?.onProgress?.(sent, all.length)
      if (isFinal) {
        if (data.committed !== true) throw new Error('分块上传：终块未提交（上游返回异常）')
        if (data.file && data.file.sha256 && data.file.sha256.toLowerCase() !== expectedSha) {
          throw new Error('sha256 校验失败：上游落盘内容与本地不一致')
        }
        return { bytes: data.file?.bytes ?? all.length, sha256: data.file?.sha256 ?? expectedSha }
      }
      if (start === sent) throw new Error('分块上传：上游未推进 offset')
    }
  } catch (e) {
    if (!(e instanceof ChunkCancelled)) await abort()   // 其它失败也取消会话，释放上游配额
    throw e
  }
}
