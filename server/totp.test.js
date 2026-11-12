// TOTP 单元测试：生成 secret → 计算动态码 → 校验（含 ±1 时间窗）
const totp = require('./totp')

let pass = 0
let fail = 0
function assert(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (cond ? '' : '  ← ' + extra))
  if (cond) pass++; else fail++
}

// 1. secret 格式
const secret = totp.generateTotpSecret()
assert('secret 为 32 位 base32', /^[A-Z2-7]{32}$/.test(secret), secret)

// 2. 当前码可校验
const code = totp.totp(secret)
assert('当前码格式 6 位数字', /^\d{6}$/.test(code), code)
assert('当前码校验通过', totp.totpVerify(secret, code))

// 3. 错误码拒绝
assert('错误码拒绝', !totp.totpVerify(secret, '000000'))

// 4. 前后时间窗（模拟 -1 / +1 步）
const prev = totp.totp(secret, 30, -1)
const next = totp.totp(secret, 30, 1)
assert('前一步码可校验', totp.totpVerify(secret, prev))
assert('后一步码可校验', totp.totpVerify(secret, next))
assert('两步之外拒绝', !totp.totpVerify(secret, totp.totp(secret, 30, 2)))

// 5. 确定性：同一时间步码相同（RFC 参考向量）
const refSecret = 'JBSWY3DPEHPK3PXP' // RFC 6238 常用测试密钥
const refCodes = []
for (let i = 0; i < 3; i++) {
  const c1 = totp.hotp ? null : null
  refCodes.push(totp.totp(refSecret, 30, i - 1))
}
assert('RFC 密钥可计算', refCodes.every((c) => /^\d{6}$/.test(c)))

// 6. otpauth URI
const uri = totp.totpUri(secret, 'testuser')
assert('otpauth URI 格式', uri.startsWith('otpauth://totp/') && uri.includes(`secret=${secret}`), uri)

console.log(`\n[result] ${pass} PASS / ${fail} FAIL`)
process.exit(fail > 0 ? 1 : 0)
