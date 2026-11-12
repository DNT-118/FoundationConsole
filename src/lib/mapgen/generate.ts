import { MAP_DATA, ZONE_META, type AtlasData, type ZoneCandidate } from './data'
import { Rng } from './rng'

/**
 * SCP:SL 地图生成算法的精确复刻（seed → 完整布局）。
 *
 * 依据：MapGeneration.SeedSynchronizer.GenerateFacility 的 IL 反编译。
 * 流程：
 *   1. rng = new Random(seed)，依次传给各区域生成器（LCZ → HCZ → EZ）
 *   2. 每区域：Atlases[rng.Next(Atlases.Length)] 选图集
 *   3. 扫描图集（步长 1 起步，首 glyph 用 GlyphCenterOffset 对齐后步长 3）
 *      每个 glyph 构造 AtlasInterpretation：Coords=(x/3, y/3)、
 *      RotationY = RoomRotations[rng.Next(len)]（每 glyph 消耗 1 次随机数）
 *   4. Fisher-Yates 洗牌：for i=len-1..1: j=rng.Next(i+1); swap(i,j)
 *   5. 按洗牌后顺序 ProcessInterpreted：
 *      - 候选过滤：hasSpecific==SpecialRoom 且（无 specific 或名匹配）且形状匹配
 *        且 prev < MaxAmount
 *      - prev < MinAmount → 直接生成（不消耗随机数）
 *      - 否则 totalWeight += GetChanceWeight（ChanceMultiplier × AdjacentChanceMultiplier^同类邻数）
 *      - roll = rng.NextDouble() * totalWeight；遍历候选累计权重，roll <= acc 选中
 *   6. 世界坐标 = (Coords.x × GridScale.x, _zoneHeight, Coords.y × GridScale.z)
 *      EZ 额外：位置 + _positionOffset（检查点质心差 + 硬偏移），旋转 + _hardRotationOffset
 */

export interface GenInterpretation {
  shape: string
  specificRooms: string[]
  rotY: number
  coordsX: number
  coordsZ: number
}

export interface SpawnedRoom {
  name: string
  shape: string
  zone: string
  coordsX: number
  coordsZ: number
  rotY: number
  worldX: number
  worldY: number
  worldZ: number
  /** 连接方向（4 邻格有房间的方向）。生成完成后统一推导，供臂式渲染。 */
  conn: { dx: number; dz: number }[]
}

export interface GenOptions {
  zoneOrder?: string[]
  zoneHeights?: Record<string, number>
  ezHardPositionOffset?: { x: number; y: number; z: number }
  ezHardRotationOffset?: number
}

export interface SpawnedData {
  candidate: ZoneCandidate
  coordsX: number
  coordsZ: number
}

const GLYPH_SIZE = 3
const BG_R = 100
const BG_G = 100
const BG_B = 100
const TOL = 5

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** 等效游戏 ScanPixel：GetPixel(x,y) → Color32，与 pairs 的 RGB ±5 匹配（不看 alpha）。 */
function scanPixel(
  bytes: Uint8Array, w: number, x: number, y: number,
): { shape: string; specificRooms: string[]; rotations: number[]; centerOffsetX: number; centerOffsetY: number } | null {
  const i = (y * w + x) * 4
  const r = bytes[i]
  const g = bytes[i + 1]
  const b = bytes[i + 2]

  // 背景色（不匹配任何 pair，等价返回 null）
  if (Math.abs(r - BG_R) <= TOL && Math.abs(g - BG_G) <= TOL && Math.abs(b - BG_B) <= TOL) {
    return null
  }

  for (const p of MAP_DATA.glyph_pairs) {
    const [pr, pg, pb] = p.color.split(',').map(Number)
    if (Math.abs(pr - r) <= TOL && Math.abs(pg - g) <= TOL && Math.abs(pb - b) <= TOL) {
      const [ox, oy] = p.center_offset.split(',').map(Number)
      return {
        shape: p.shape,
        specificRooms: p.specific_rooms,
        rotations: p.rotations,
        centerOffsetX: ox,
        centerOffsetY: oy,
      }
    }
  }
  return null
}

/** 等效游戏 MapAtlasInterpreter.Interpret：带首 glyph 对齐的扫描，返回解释结果（含旋转消耗）。 */
export function interpretAtlasOrdered(atlas: AtlasData, rng: Rng): GenInterpretation[] {
  const bytes = base64ToBytes(atlas.rgba)
  const w = atlas.width
  const h = atlas.height
  const results: GenInterpretation[] = []

  let step = 1
  let xStart = 0
  let aligned = false
  let y = 0

  while (y < h) {
    let x = xStart
    while (x < w) {
      const pair = scanPixel(bytes, w, x, y)
      if (pair) {
        if (!aligned) {
          // 首次 glyph：用 GlyphCenterOffset 校正起点，步长变 3，x 起点对齐 3 网格
          x += pair.centerOffsetX
          y += pair.centerOffsetY
          step = GLYPH_SIZE
          xStart = x % GLYPH_SIZE
          aligned = true
        }
        // AtlasInterpretation 构造器：Coords = (x/3, y/3)，RotationY = rotations[rng.Next(len)]
        results.push({
          shape: pair.shape,
          specificRooms: pair.specificRooms,
          coordsX: Math.floor(x / GLYPH_SIZE),
          coordsZ: Math.floor(y / GLYPH_SIZE),
          rotY: pair.rotations[rng.nextInt(pair.rotations.length)],
        })
      }
      x += step
    }
    y += step
  }

  return results
}

/** 等效游戏 Fisher-Yates 洗牌（RandomizeInterpreted）。 */
function shuffle(interpreted: GenInterpretation[], rng: Rng): void {
  for (let i = interpreted.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1)
    const tmp = interpreted[i]
    interpreted[i] = interpreted[j]
    interpreted[j] = tmp
  }
}

/** 候选唯一标识：游戏用 SpawnableRoom 对象引用比较，走廊候选同名（Unnamed），
 *  用 name|shape|chance|min|max 区分（与对象引用等价，避免同名互相污染计数）。 */
function candKey(c: ZoneCandidate): string {
  return `${c.name}|${c.shape}|${c.chance}|${c.min}|${c.max}`
}

/** 等效 GetChanceWeight：ChanceMultiplier × AdjacentChanceMultiplier^同类邻数。 */
function chanceWeight(
  coordsX: number, coordsZ: number, candidate: ZoneCandidate, spawned: SpawnedData[],
): number {
  let w = candidate.chance
  const k = candKey(candidate)
  for (const s of spawned) {
    if (candKey(s.candidate) === k) {
      const dx = Math.abs(s.coordsX - coordsX)
      const dz = Math.abs(s.coordsZ - coordsZ)
      if ((dx === 1 && dz === 0) || (dx === 0 && dz === 1)) {
        w *= candidate.adj_chance
      }
    }
  }
  return w
}

function previouslySpawnedCnt(candidate: ZoneCandidate, spawned: SpawnedData[]): number {
  const k = candKey(candidate)
  let n = 0
  for (const s of spawned) if (candKey(s.candidate) === k) n++
  return n
}

/** 等效游戏 EntranceZoneGenerator.OnBeforeRandomize：
 *  _positionOffset = (HCZ检查点质心 - EZ检查点质心) + _hardPositionOffset
 * 用图集槽位坐标（无偏移）计算检查点质心；纯几何，不消耗随机数。
 * 效果上 EZ 最终位置 = HCZ 检查点质心 + 硬偏移（EZ 自身质心抵消）。 */
function checkpointCentroid(interpreted: GenInterpretation[]): { x: number; z: number } {
  const gs = MAP_DATA.grid_scale
  let sx = 0
  let sz = 0
  let n = 0
  for (const i of interpreted) {
    if (i.specificRooms.includes('HczCheckpointToEntranceZone')) {
      sx += i.coordsX * gs
      sz += i.coordsZ * gs
      n++
    }
  }
  return n > 0 ? { x: sx / n, z: sz / n } : { x: 0, z: 0 }
}

/** 生成单个区域。 */
function generateZone(
  rng: Rng,
  zone: string,
  zoneHeight: number,
  candidates: ZoneCandidate[],
  ezHczInterpreted: GenInterpretation[] | null,
  ezOffsets: { pos: { x: number; y: number; z: number }; rot: number } | null,
): { rooms: SpawnedRoom[]; interpreted: GenInterpretation[] } {
  const rooms: SpawnedRoom[] = []
  const spawned: SpawnedData[] = []

  // 1. 选图集：Atlases[rng.Next(Atlases.Length)]
  const atlases = MAP_DATA.atlases.filter((a) =>
    zone === 'HeavyContainment' ? a.name.startsWith('HC') :
    zone === 'LightContainment' ? a.name.startsWith('LC') : a.name.startsWith('EZ'))
  if (atlases.length === 0) return { rooms, interpreted: [] }
  const atlas = atlases[rng.nextInt(atlases.length)]

  // 2. 解释图集（每 glyph 消耗 1 次随机数选旋转）
  const interpreted = interpretAtlasOrdered(atlas, rng)

  // 3. EZ：洗牌前计算检查点对齐偏移（OnBeforeRandomize）
  let ezApplied: { x: number; y: number; z: number } | null = null
  if (zone === 'Entrance') {
    const hard = ezOffsets?.pos ?? { x: 0, y: 0, z: 0 }
    if (ezHczInterpreted) {
      const hczC = checkpointCentroid(ezHczInterpreted)
      const ezC = checkpointCentroid(interpreted)
      ezApplied = {
        x: hczC.x - ezC.x + hard.x,
        y: hard.y,
        z: hczC.z - ezC.z + hard.z,
      }
    } else {
      ezApplied = { ...hard }
    }
  }

  // 4. 洗牌
  shuffle(interpreted, rng)

  // 4. 逐个处理槽位
  for (const interp of interpreted) {
    const hasSpecific = interp.specificRooms.length > 0
    let totalWeight = 0
    const pool: ZoneCandidate[] = []

    for (const candidate of candidates) {
      const prev = previouslySpawnedCnt(candidate, spawned)
      // hasSpecific == candidate.special（specific 槽位只接受 special 房间）
      if (hasSpecific !== candidate.special) continue
      // 有 specific 时房间名必须匹配
      if (hasSpecific && !interp.specificRooms.includes(candidate.name)) continue
      // 形状必须匹配
      if (candidate.shape !== interp.shape) continue
      // 未超上限
      if (prev >= candidate.max) continue

      if (prev < candidate.min) {
        // MinAmount 分支：直接生成，不消耗随机数
        spawnRoom(interp, candidate, zone, zoneHeight, spawned, rooms, ezApplied, ezOffsets?.rot ?? 0)
        totalWeight = -1 // 标记已生成
        break
      }
      totalWeight += chanceWeight(interp.coordsX, interp.coordsZ, candidate, spawned)
      pool.push(candidate)
    }

    if (totalWeight === -1) continue // 已通过 MinAmount 生成
    if (pool.length === 0 || totalWeight === 0) continue // 无候选（游戏记错误日志后跳过）

    // 加权随机：roll = rng.NextDouble() * totalWeight；roll <= acc 选中
    const roll = rng.nextDouble() * totalWeight
    let acc = 0
    for (const candidate of pool) {
      acc += chanceWeight(interp.coordsX, interp.coordsZ, candidate, spawned)
      if (roll <= acc) {
        spawnRoom(interp, candidate, zone, zoneHeight, spawned, rooms, ezApplied, ezOffsets?.rot ?? 0)
        break
      }
    }
  }

  return { rooms, interpreted }
}

function spawnRoom(
  interp: GenInterpretation,
  candidate: ZoneCandidate,
  zone: string,
  zoneHeight: number,
  spawned: SpawnedData[],
  rooms: SpawnedRoom[],
  ezOffset: { x: number; y: number; z: number } | null,
  ezRotOffset: number,
): void {
  // GetPositionAndRotation：world = (Coords.x × GridScale.x, _zoneHeight, Coords.y × GridScale.z)
  const gs = MAP_DATA.grid_scale
  let wx = interp.coordsX * gs
  let wy = zoneHeight
  let wz = interp.coordsZ * gs
  let rot = interp.rotY

  // EZ：位置 + _positionOffset（检查点对齐），旋转 + _hardRotationOffset
  if (zone === 'Entrance' && ezOffset) {
    wx += ezOffset.x
    wy += ezOffset.y
    wz += ezOffset.z
    rot += ezRotOffset
  }

  spawned.push({ candidate, coordsX: interp.coordsX, coordsZ: interp.coordsZ })
  rooms.push({
    name: candidate.name,
    shape: candidate.shape,
    zone,
    coordsX: interp.coordsX,
    coordsZ: interp.coordsZ,
    rotY: rot,
    worldX: wx,
    worldY: wy,
    worldZ: wz,
    conn: [],
  })
}

/** 特殊房间的固定开口（游戏模型门位置，不随邻居变化；fxdyj 数据证实）。
 *  HczCheckpointToEntranceZone：桥接 HCZ/EZ 的检查点，东西两侧都有门，
 *  即使对侧槽位不在同楼层图集内也保持左右开口。 */
const FIXED_CONN: Record<string, { dx: number; dz: number }[]> = {
  HczCheckpointToEntranceZone: [{ dx: -1, dz: 0 }, { dx: 1, dz: 0 }],
}

/** 具体房间的模型开口模式（游戏模型坐标系，[dx,dz] 方向，与 rotY 无关）。
 *  提取自 fxdyj 真实布局数据（逆旋转收敛验证：38/38 房间类型唯一模式）。
 *  实际开口 = 模式旋转 rotY 后 ∩ 组内邻居。 */
const ROOM_CONN_PATTERN: Record<string, [number, number][]> = {
  EzEvacShelter: [[0, 1]], EzGateA: [[0, 1]], EzGateB: [[0, 1]],
  EzCollapsedTunnel: [[0, 1]],
  EzIntercom: [[-1, 0], [0, -1]],
  EzOfficeLarge: [[0, -1], [0, 1]], EzOfficeSmall: [[0, -1], [0, 1]], EzOfficeStoried: [[0, -1], [0, 1]],
  EzRedroom: [[0, 1]],
  Hcz049: [[-1, 0], [1, 0]], Hcz079: [[-1, 0]], Hcz096: [[-1, 0]], Hcz106: [[-1, 0]],
  Hcz127: [[-1, 0], [0, -1], [0, 1]], Hcz939: [[0, -1], [1, 0]],
  HczAcroamaticAbatement: [[-1, 0], [0, -1], [0, 1], [1, 0]],
  HczArmory: [[-1, 0], [0, -1], [0, 1]],
  HczCheckpointA: [[-1, 0]], HczCheckpointB: [[-1, 0]],
  HczMicroHID: [[-1, 0], [1, 0]], HczRampTunnel: [[-1, 0], [0, -1], [0, 1]],
  HczServers: [[-1, 0], [1, 0]], HczTesla: [[-1, 0], [1, 0]], HczTestroom: [[-1, 0], [1, 0]],
  HczWarhead: [[-1, 0], [0, -1], [0, 1]], HczWaysideIncinerator: [[0, -1], [1, 0]],
  Lcz173: [[-1, 0]], Lcz330: [[-1, 0]], Lcz914: [[-1, 0]],
  LczAirlock: [[-1, 0], [1, 0]], LczArmory: [[-1, 0]],
  LczCheckpointA: [[-1, 0]], LczCheckpointB: [[-1, 0]],
  LczClassDSpawn: [[1, 0]], LczComputerRoom: [[-1, 0]], LczGlassroom: [[-1, 0]],
  LczGreenhouse: [[-1, 0], [1, 0]], LczToilets: [[-1, 0], [1, 0]],
}

/** 电梯检查点：开口方向随 rotY 旋转，但不 ∩ 邻居（门朝向固定位置，
 *  即使对侧槽位没有房间也画臂 —— fxdyj 数据证实）。 */
const CHECKPOINT_NO_INTERSECT: Record<string, true> = {
  LczCheckpointA: true, LczCheckpointB: true,
  HczCheckpointA: true, HczCheckpointB: true,
}

/** 走廊（Unnamed）的模型开口模式（fxdyj 数据逆旋转收敛后的众数）：
 *  Curve=[N,E]、Straight=[W,E]、TShape=[W,N,S]、XShape=全向。
 *  少数布局存在镜像变体（如 TShape [W,S,E]），无法从 seed 推导，取众数。 */
const CORRIDOR_CONN_PATTERN: Record<string, [number, number][]> = {
  Curve: [[0, -1], [1, 0]],
  Straight: [[-1, 0], [1, 0]],
  TShape: [[-1, 0], [0, -1], [0, 1]],
  XShape: [[-1, 0], [0, -1], [0, 1], [1, 0]],
}

/** 方向随房间旋转（Unity Y 轴顺时针）：90°=(dx,dz)→(dz,-dx)… */
function rotateConn(dx: number, dz: number, rotY: number): [number, number] {
  const t = ((rotY % 360) + 360) % 360
  if (t === 90) return [dz, -dx]
  if (t === 180) return [-dx, -dz]
  if (t === 270) return [-dz, dx]
  return [dx, dz]
}

/** 入口：seed → 完整布局（纯本地算法，不依赖服务器运行时）。 */
export function generateLayout(seed: number, opts: GenOptions = {}): SpawnedRoom[] {
  const rng = new Rng(seed)
  const rooms: SpawnedRoom[] = []

  // 默认使用导出的区域元数据（ZONE_META）；opts 可覆盖（验证用）
  const zoneOrder = opts.zoneOrder ?? ZONE_META.order.filter((z) =>
    z === 'LightContainment' || z === 'HeavyContainment' || z === 'Entrance')
  const zoneHeights = opts.zoneHeights ?? (ZONE_META.heights as Record<string, number>)
  const ezHardPos = opts.ezHardPositionOffset ?? ZONE_META.ezHardPositionOffset
  const ezHardRot = opts.ezHardRotationOffset ?? ZONE_META.ezHardRotationOffset
  const candidates = MAP_DATA.zone_candidates as Record<string, ZoneCandidate[]>

  // EZ 对齐：需要 HCZ 的 Interpreted（检查点质心差），HCZ 必须先生成
  let hczInterpreted: GenInterpretation[] | null = null

  for (const zone of zoneOrder) {
    const isEZ = zone === 'Entrance'
    const ezOffsets = isEZ && ezHardPos
      ? {
          pos: ezHardPos,
          rot: ezHardRot,
        }
      : null

    const gen = generateZone(
      rng, zone, zoneHeights[zone] ?? 0, candidates[zone] ?? [],
      isEZ ? hczInterpreted : null,
      ezOffsets,
    )

    if (zone === 'HeavyContainment') hczInterpreted = gen.interpreted
    rooms.push(...gen.rooms)
  }

  // 生成完成后推导连接方向（臂式渲染用）。
  // 注意：各区域图集槽位坐标从 (0,0) 起、彼此重叠，邻接判定必须按楼层分组：
  // LCZ 独立一组；HCZ 与 EZ 同层且槽位相邻（检查点桥接），合并为一组。
  // 形状决定开口数量（TShape 3 向 / Straight、Curve 2 向 / Endroom 1 向 / XShape 4 向），
  // 特殊房间（检查点）开口固定 —— 修掉"卫生间四通八达 / T 型画成十字"。
  const groups: SpawnedRoom[][] = [
    rooms.filter((r) => r.zone === 'LightContainment'),
    rooms.filter((r) => r.zone !== 'LightContainment'),
  ]
  for (const grp of groups) {
    const byCoord = new Map<string, SpawnedRoom>()
    for (const r of grp) byCoord.set(`${r.coordsX},${r.coordsZ}`, r)
    for (const r of grp) {
      if (FIXED_CONN[r.name]) {
        r.conn = FIXED_CONN[r.name].map((c) => ({ ...c }))
        continue
      }
      const nbrs: { dx: number; dz: number }[] = []
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (byCoord.has(`${r.coordsX + dx},${r.coordsZ + dz}`)) nbrs.push({ dx, dz })
      }
      if (ROOM_CONN_PATTERN[r.name]) {
        // 具体房间：模型开口旋转 rotY（检查点类不 ∩ 邻居，其余 ∩ 实际邻居）
        const rotated = ROOM_CONN_PATTERN[r.name].map(([dx, dz]) => rotateConn(dx, dz, r.rotY))
        r.conn = rotated
          .filter((c) => CHECKPOINT_NO_INTERSECT[r.name] || nbrs.some((n) => n.dx === c[0] && n.dz === c[1]))
          .map(([dx, dz]) => ({ dx, dz }))
      } else {
        // 走廊：模型开口模式（众数）旋转 rotY 后 ∩ 实际邻居。
        // 注意：EZ 的 rotY 含 _hardRotationOffset(270)（区块整体转向），但走廊开口
        // 不随该偏移旋转（fxdyj 数据证实：EZ 走廊逆旋转全部收敛到"模式偏 270°"），
        // 推导时必须扣回偏移；具体房间的模式表已含偏移（提取自 EZ 数据），无需扣。
        const pat = CORRIDOR_CONN_PATTERN[r.shape]
        if (pat) {
          const rotY = r.zone === 'Entrance' ? r.rotY - ezHardRot : r.rotY
          r.conn = pat
            .map(([dx, dz]) => rotateConn(dx, dz, rotY))
            .filter((c) => nbrs.some((n) => n.dx === c[0] && n.dz === c[1]))
            .map(([dx, dz]) => ({ dx, dz }))
        } else {
          r.conn = nbrs.slice(0, 1) // 无模式形状（如 Endroom 走廊）：取第一个邻居
        }
      }
    }
  }

  return rooms
}
