// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * 通知规则评估（R4）：wsHub 收到上游控制 WS 事件后调用 handleEvent(serverId, event, data)。
 *  - 匹配用户规则（enabled、事件类型、serverId 或 '*'；用户需对该服务器有访问权）；
 *  - 频率限制：同一规则 + 事件在 minIntervalSeconds 内只发一次（内存态 lastSentAt）；
 *  - 去重：同一 (username, event, payload 摘要) 在 60s 内只发一次（跨规则兜底）；
 *  - 站内通知写 store.addNotification（通知中心收件箱）；
 *  - 邮件通道仅限管理员用户的规则，经注入的 sendEmail 使用已配置的 SMTP（同样受限频）。
 * 全部 fire-and-forget：通知失败只打日志，绝不影响游戏事件转发。
 */
const store = require('./store')

const PAYLOAD_DEDUP_MS = 60_000
const EMAIL_MIN_GAP_MS = 60_000

/** ruleId+event -> lastSentAt（频率限制）；username|event|hash -> lastSentAt（去重）。 */
const lastSent = new Map()
const lastEmail = new Map() // username -> ts

/**
 * 事件名白名单化：Subject/日志只允许字母数字与 - _ .，
 * 防止被攻陷的游戏服经上游事件名向邮件 Subject 注入头（CRLF/换行/冒号）。
 */
function safeEventName(event) {
  return String(event || '').replace(/[^\w.-]/g, '').slice(0, 64) || 'unknown'
}

function payloadDigest(data) {
  try { return require('node:crypto').createHash('sha1').update(JSON.stringify(data ?? {})).digest('hex').slice(0, 12) } catch { return '' }
}

function summaryFor(event, data) {
  const d = data && typeof data === 'object' ? data : {}
  const nick = (k) => String(d[k] || '')
  switch (event) {
    case 'player_banned': return `${nick('nickname') || nick('userid')} 被封禁（${nick('issuer_nickname') || '未知操作者'}）：${nick('reason') || '无理由'}`
    case 'player_kicked': return `${nick('nickname')} 被踢出（${nick('issuer_nickname') || '未知操作者'}）`
    case 'player_escaped': return `${nick('nickname')} 逃脱：${nick('old_role')} → ${nick('new_role')}`
    case 'player_role_changed': return `${nick('nickname')} 职业变更：${nick('old_role')} → ${nick('new_role')}`
    case 'player_reported': return `新举报：${nick('reporter_nickname')} 举报 ${nick('target_nickname')} — ${nick('reason') || '无理由'}`
    case 'wave_respawned': return `${nick('team') || nick('faction')} 波次重生（${d.count ?? '?'} 人）`
    case 'decontamination_started': return '轻收容区去污开始'
    case 'generator_activated': return `发电机启动（${d.engaged ?? '?'}/${d.total ?? '?'}）`
    case 'scp_terminated': return `SCP 收容播报：${nick('nickname') || nick('role')}`
    case 'warhead_started': return '核弹已启动'
    case 'warhead_stopped': return '核弹已中止'
    case 'warhead_detonated': return '核弹已爆炸'
    default: return event
  }
}

let deps = { accessRole: () => null, isPlatformAdmin: () => false, sendEmail: null }

/** server.js 注入：accessRole(username, serverId)、isPlatformAdmin(username)、sendEmail({to, subject, text})。 */
function init(d) { deps = { ...deps, ...d } }

/** wsHub 每条上游事件调用（异步，吞异常）。 */
function handleEvent(serverId, event, data) {
  try {
    const now = Date.now()
    const seen = new Set() // 本次事件内同一用户只处理一次（多规则命中合并）
    for (const rule of store.listNotifyRules()) {
      if (!rule.enabled) continue
      if (!rule.events.includes(event)) continue
      if (rule.serverId !== '*' && rule.serverId !== serverId) continue
      const username = rule.username
      if (seen.has(username)) continue
      if (!deps.accessRole(username, serverId)) continue // 用户已无该服务器访问权 → 不通知

      // 频率限制：同规则 + 事件
      const ruleKey = `${rule.id}|${event}`
      const last = lastSent.get(ruleKey) || 0
      if (now - last < rule.minIntervalSeconds * 1000) continue

      // 去重：同用户 + 事件 + 内容摘要
      const dupKey = `${username}|${event}|${payloadDigest(data)}`
      const lastDup = lastSent.get(dupKey) || 0
      if (now - lastDup < PAYLOAD_DEDUP_MS) continue

      lastSent.set(ruleKey, now)
      lastSent.set(dupKey, now)
      seen.add(username)

      const text = summaryFor(event, data)
      if (rule.inapp !== false) {
        store.addNotification({ username, serverId, event, text })
      }
      if (rule.email === true && deps.isPlatformAdmin(username) && typeof deps.sendEmail === 'function') {
        const to = store.getUser(username)?.email || ''
        if (to) {
          const emailGap = now - (lastEmail.get(username) || 0)
          if (emailGap >= EMAIL_MIN_GAP_MS) {
            lastEmail.set(username, now)
            void Promise.resolve(deps.sendEmail({ to, serverId, event, text })).catch((e) => {
              console.error('[PFC] 通知邮件发送失败:', e && e.message ? e.message : e)
            })
          }
        }
      }
    }
    // 内存态防泄漏：只保留最近 5000 个键
    if (lastSent.size > 5000) {
      for (const k of lastSent.keys()) { lastSent.delete(k); if (lastSent.size <= 2500) break }
    }
  } catch (e) {
    console.error('[PFC] 通知规则评估失败:', e && e.message ? e.message : e)
  }
}

/** 测试钩子：清空内存态。 */
function resetState() { lastSent.clear(); lastEmail.clear() }

module.exports = { init, handleEvent, resetState, summaryFor, safeEventName, NOTIFY_EVENTS: () => store.NOTIFY_EVENTS }
