/**
 * SMTP 邮件发送（nodemailer）。
 * 支持两种认证：
 *  - password：邮箱授权码/应用密码（QQ/163/Gmail 等）
 *  - oauth2：OAuth2（Outlook/Office365 —— 2024 年起禁用基础认证，必须 OAuth2）
 */
const dns = require('node:dns')

let nodemailer = null
try {
  nodemailer = require('nodemailer')
} catch {
  nodemailer = null
}

/** 构造 transporter；未指定时默认 smtp.qq.com:465。 */
function createTransporter(smtp) {
  if (!nodemailer) {
    throw new Error('nodemailer 未安装（npm install nodemailer）')
  }
  if (!smtp || !smtp.user) {
    throw new Error('SMTP 未配置 — 请管理员在后台填写邮箱配置')
  }
  let auth
  if (smtp.authMode === 'oauth2') {
    if (!smtp.clientId || !smtp.clientSecret || !smtp.refreshToken) {
      throw new Error('OAuth2 配置不完整（clientId / clientSecret / refreshToken）')
    }
    auth = {
      type: 'OAuth2',
      user: smtp.user,
      clientId: smtp.clientId,
      clientSecret: smtp.clientSecret,
      refreshToken: smtp.refreshToken,
    }
  } else {
    if (!smtp.pass) {
      throw new Error('SMTP 未配置 — 请管理员在后台填写邮箱与授权码')
    }
    auth = { user: smtp.user, pass: smtp.pass }
  }
  return nodemailer.createTransport({
    host: smtp.host || 'smtp.qq.com',
    port: smtp.port || 465,
    secure: (smtp.port || 465) === 465,
    auth,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  })
}

/** 解析 SMTP 主机 IP（诊断用：确认 DNS 是否被污染/改指）。 */
async function resolveHostIp(host) {
  try {
    const r = await dns.promises.lookup(host, { verbatim: true })
    return r.address
  } catch (e) {
    return `解析失败（${e.message}）`
  }
}

/**
 * 构造发件人：信封发件人（MAIL FROM）固定为发信邮箱 —— QQ/163 等强制要求
 * 等于认证账号，否则返回 550 Invalid User；from 字段仅作显示名（纯装饰）。
 */
function buildSender(smtp) {
  const address = smtp.user
  const name = (smtp.from || '').trim()
  if (name && !/[@<>"]/.test(name)) {
    return { from: { name, address }, envelopeFrom: address }
  }
  return { from: address, envelopeFrom: address }
}

/** 发送验证码邮件。返回 Promise；失败时错误信息带上实际 host:port。 */
async function sendVerificationEmail(smtp, email, code) {
  const host = (smtp && smtp.host) || 'smtp.qq.com'
  const port = (smtp && smtp.port) || 465
  try {
    const transporter = createTransporter(smtp)
    const { from, envelopeFrom } = buildSender(smtp)
    await transporter.sendMail({
      from,
      envelope: { from: envelopeFrom, to: [email] },
      to: email,
      subject: '基金会控制台 · 注册验证码',
      text: `您的注册验证码是：${code}\n验证码 5 分钟内有效，请勿泄露给他人。`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #333;border-radius:8px;background:#0a0a0a;color:#eee">
      <h2 style="margin:0 0 16px;letter-spacing:2px">基金会控制台</h2>
      <p>您的注册验证码是：</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#ffd166">${code}</p>
      <p style="color:#888;font-size:12px">验证码 5 分钟内有效，请勿泄露给他人。</p>
    </div>`,
    })
  } catch (e) {
    e.message = `SMTP 发送失败（${host}:${port}）：${e.message}`
    throw e
  }
}

/**
 * 测试发送（后台"测试发送"按钮）：先解析 host 的 IP，再真实发一封。
 * 成功返回 { ok:true, host, port, ip }；失败抛错，错误信息带 host:port 与解析 IP。
 */
async function sendTest(smtp, to) {
  const host = (smtp && smtp.host) || 'smtp.qq.com'
  const port = (smtp && smtp.port) || 465
  const ip = await resolveHostIp(host)
  try {
    const transporter = createTransporter(smtp)
    const { from, envelopeFrom } = buildSender(smtp)
    await transporter.sendMail({
      from,
      envelope: { from: envelopeFrom, to: [to] },
      to,
      subject: '基金会控制台 · SMTP 测试邮件',
      text: '这是一封测试邮件：SMTP 配置正常，注册验证码可以正常发送。',
    })
    return { ok: true, host, port, ip }
  } catch (e) {
    e.message = `SMTP 发送失败（${host}:${port}，解析 IP ${ip}）：${e.message}`
    e.host = host
    e.port = port
    e.ip = ip
    throw e
  }
}

module.exports = { createTransporter, sendVerificationEmail, sendTest }
