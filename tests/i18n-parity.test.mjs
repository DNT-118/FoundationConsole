import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dict } from '../src/i18n/dict.ts'

test('zh-CN and en dictionaries have identical key sets', () => {
  const zh = Object.keys(dict['zh-CN']).sort()
  const en = Object.keys(dict.en).sort()
  const onlyZh = zh.filter((k) => !en.includes(k))
  const onlyEn = en.filter((k) => !zh.includes(k))
  assert.deepEqual(onlyZh, [], `keys missing in en: ${onlyZh.join(', ')}`)
  assert.deepEqual(onlyEn, [], `keys missing in zh-CN: ${onlyEn.join(', ')}`)
})

test('no dictionary value is empty or whitespace-only', () => {
  for (const [locale, entries] of Object.entries(dict)) {
    for (const [key, value] of Object.entries(entries)) {
      assert.ok(typeof value === 'string' && value.trim() !== '', `${locale}.${key} is empty`)
    }
  }
})

test('no duplicate keys were silently collapsed in the dict source', () => {
  const source = readFileSync(new URL('../src/i18n/dict.ts', import.meta.url), 'utf8')
  // 按 locale 分块检查：'zh-CN': { ... } 与 en: { ... } 之间不允许同名键出现两次
  const zhStart = source.indexOf("'zh-CN': {")
  const enStart = source.indexOf("  en: {")
  assert.ok(zhStart > 0 && enStart > zhStart, 'locale block markers not found')
  const blocks = [
    ['zh-CN', source.slice(zhStart, enStart)],
    ['en', source.slice(enStart)],
  ]
  for (const [locale, text] of blocks) {
    const keys = [...text.matchAll(/'([^']+)':/g)].map((m) => m[1])
    const seen = new Set()
    const dupes = []
    for (const k of keys) {
      if (seen.has(k)) dupes.push(k)
      seen.add(k)
    }
    assert.deepEqual([...new Set(dupes)], [], `${locale} has duplicate keys: ${[...new Set(dupes)].join(', ')}`)
  }
})
