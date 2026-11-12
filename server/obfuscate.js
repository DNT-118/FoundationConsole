// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * 发布混淆脚本：对 server 目录的核心代码做混淆（防蒸馏/防逆向）。
 * 用法：node server/obfuscate.js
 * 输出：server-dist/（混淆后的后端 + 拷贝 package.json）
 * 运行混淆后版本：node server-dist/server.js（需 PFC_MASTER_KEY 或 data/master.key）
 */
const fs = require('node:fs')
const path = require('node:path')

let obfuscator
try {
  obfuscator = require('javascript-obfuscator')
} catch {
  console.error('请先安装：npm install --save-dev javascript-obfuscator')
  process.exit(1)
}

const SRC = path.join(__dirname)
const OUT = path.join(__dirname, '..', 'server-dist')
// 混淆 server/ 下全部运行时模块（排除测试与本脚本），避免发布包缺少依赖模块
const FILES = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'obfuscate.js')
  .sort()

if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

for (const f of FILES) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8')
  const result = obfuscator.obfuscate(src, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.6,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.3,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: true,      // 防格式化/调试
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    transformObjectKeys: true,
  }).getObfuscatedCode()
  fs.writeFileSync(path.join(OUT, f), result)
  console.log(`obfuscated ${f} (${(src.length / 1024).toFixed(1)}KB → ${(result.length / 1024).toFixed(1)}KB)`)
}

// 拷贝 package.json / package-lock.json（CommonJS 声明与锁定依赖）
fs.copyFileSync(path.join(SRC, 'package.json'), path.join(OUT, 'package.json'))
if (fs.existsSync(path.join(SRC, 'package-lock.json'))) {
  fs.copyFileSync(path.join(SRC, 'package-lock.json'), path.join(OUT, 'package-lock.json'))
}
console.log(`\n完成：${OUT}`)
console.log('运行：node server-dist/server.js（环境变量 PORT / PFC_MASTER_KEY）')
