import { MAP_DATA, type AtlasData, type GlyphPairData } from './data'

/**
 * Atlas 图集解释器：把图集贴图解码为"glyph 槽位"列表。
 *
 * 图集规则（来自游戏 MapAtlasInterpreter.Interpret 的逆向）：
 * - 每张图集是 32×32 像素，glyph 为 3×3 像素网格（10×10 个槽位）
 * - 每个 glyph 的中心像素颜色决定房间形状与朝向（±5 容差匹配 GlyphShapePair）
 * - 背景色 (100,100,100) 表示无房间
 * - GlyphShapePair 的 specific_rooms 非空时该槽位强制放指定房间
 */

export interface Glyph {
  shape: string
  /** 该 glyph 可能的方向（度），实际方向由生成算法决定 */
  rotations: number[]
  /** 网格坐标（glyph 槽位） */
  gx: number
  gz: number
  /** 强制房间（specific_rooms 非空时） */
  specificRooms: string[]
  color: string
}

const GLYPH_SIZE = 3
const BG_R = 100
const BG_G = 100
const BG_B = 100
const COLOR_TOLERANCE = 5

function isBackground(r: number, g: number, b: number, a: number): boolean {
  return a === 0 ||
    (Math.abs(r - BG_R) <= COLOR_TOLERANCE &&
     Math.abs(g - BG_G) <= COLOR_TOLERANCE &&
     Math.abs(b - BG_B) <= COLOR_TOLERANCE)
}

function colorMatch(pair: GlyphPairData, r: number, g: number, b: number, a: number): boolean {
  const [pr, pg, pb, pa] = pair.color.split(',').map(Number)
  return Math.abs(pr - r) <= COLOR_TOLERANCE &&
    Math.abs(pg - g) <= COLOR_TOLERANCE &&
    Math.abs(pb - b) <= COLOR_TOLERANCE &&
    Math.abs(pa - a) <= COLOR_TOLERANCE
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** 解码单张图集 → glyph 槽位列表。 */
export function interpretAtlas(atlas: AtlasData): Glyph[] {
  const bytes = base64ToBytes(atlas.rgba)
  const w = atlas.width
  const glyphs: Glyph[] = []

  for (let gy = 0; gy < 10; gy++) {
    for (let gx = 0; gx < 10; gx++) {
      const px = gx * GLYPH_SIZE + 1
      const py = gy * GLYPH_SIZE + 1
      if (px >= w) continue
      const i = (py * w + px) * 4
      const r = bytes[i]
      const g = bytes[i + 1]
      const b = bytes[i + 2]
      const a = bytes[i + 3]

      if (isBackground(r, g, b, a)) continue

      const pair = MAP_DATA.glyph_pairs.find((p) => colorMatch(p, r, g, b, a))
      if (!pair) {
        console.warn(`[atlas] 未匹配的颜色 ${r},${g},${b},${a} at (${gx},${gy}) in ${atlas.name}`)
        continue
      }

      glyphs.push({
        shape: pair.shape,
        rotations: [...pair.rotations],
        gx,
        gz: gy,
        specificRooms: [...pair.specific_rooms],
        color: pair.color,
      })
    }
  }

  return glyphs
}

/** 解码所有图集，按区域分组（图集名前缀：HC_/LC_/EZ_）。 */
export function interpretAll(): Record<string, Glyph[]> {
  const result: Record<string, Glyph[]> = {}
  for (const atlas of MAP_DATA.atlases) {
    const zone = atlas.name.startsWith('HC') ? 'HeavyContainment'
      : atlas.name.startsWith('LC') ? 'LightContainment'
        : 'Entrance'
    const glyphs = interpretAtlas(atlas)
    if (!result[zone]) result[zone] = []
    result[zone].push(...glyphs)
    // console.log(`[atlas] ${atlas.name}: ${glyphs.length} glyphs`)
  }
  return result
}
