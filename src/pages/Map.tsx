import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Map as MapIcon } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import { useT } from '@/i18n'
import { useControlMutation, useControlSource, makeControlQueryFn } from '@/hooks/useControl'
import { useServerQuery } from '@/hooks/useServerQuery'
import { describeControlError, holidayLabel } from '@/utils/controlHint'
import { generateLayout, type SpawnedRoom } from '@/lib/mapgen/generate'
import { MAP_DATA } from '@/lib/mapgen/data'
import { roomLabel } from '@/lib/mapgen/roomNames'
import type { MapLayout, MapRoom, MapStatusResult, Team } from '@/types/api'
import type { TKey } from '@/i18n/dict'

/** 形状 → 网格占用（× GridScale = 世界尺寸）。 */
function shapeGridSize(shape: string): { gw: number; gd: number } {
  switch (shape) {
    case 'Endroom': return { gw: 1, gd: 1 }
    case 'Straight': return { gw: 2, gd: 1 }
    case 'Curve': return { gw: 2, gd: 1 }
    case 'TShape': return { gw: 3, gd: 1 }
    case 'XShape': return { gw: 3, gd: 1 }
    default: return { gw: 1, gd: 1 }
  }
}

/** fxdyj 房间形状分类（提取自 scpslmaps.fxdyj.com 数据）：房间类型 → 图形。
 *  octagon=SCP 收容间 / gate=检查点与大 / shield=军械库 / hex=核弹与 HID /
 *  dead=死路 / circle=焚化炉 / pass=通道（无体） / corridor=走廊（无体）。
 *  未列出的房间类型默认圆角矩形 rect（与 fxdyj 一致）。 */
const GLYPH_BY_NAME: Record<string, string> = {
  Lcz173: 'octagon', Lcz330: 'octagon', Lcz914: 'octagon',
  Hcz049: 'octagon', Hcz079: 'octagon', Hcz096: 'octagon',
  Hcz106: 'octagon', Hcz127: 'octagon', Hcz939: 'octagon',
  LczAirlock: 'gate', LczCheckpointA: 'gate', LczCheckpointB: 'gate',
  HczCheckpointA: 'gate', HczCheckpointB: 'gate', HczCheckpointToEntranceZone: 'gate',
  EzGateA: 'gate', EzGateB: 'gate',
  LczArmory: 'shield', HczArmory: 'shield',
  HczMicroHID: 'hex', HczWarhead: 'hex',
  HczWaysideIncinerator: 'circle',
  EzCollapsedTunnel: 'dead',
  EzEvacShelter: 'dead', EzRedroom: 'dead',
  HczRampTunnel: 'pass', HczTesla: 'pass',
}

/** 多边形 body（octagon/hex/shield/dead）→ SVG points（fxdyj bodyPath 同款几何）。 */
function polyPoints(
  glyph: string, cx: number, cy: number, bw: number, bh: number, cell: number,
): string {
  const pts: [number, number][] = []
  const x0 = cx - bw / 2, x1 = cx + bw / 2, y0 = cy - bh / 2, y1 = cy + bh / 2
  if (glyph === 'octagon') {
    const k = Math.min(0.16 * cell, bw / 3, bh / 3)
    pts.push([x0 + k, y0], [x1 - k, y0], [x1, y0 + k], [x1, y1 - k],
      [x1 - k, y1], [x0 + k, y1], [x0, y1 - k], [x0, y0 + k])
  } else if (glyph === 'hex') {
    const k = bw * 0.2
    pts.push([x0 + k, y0], [x1 - k, y0], [x1, cy], [x1 - k, y1], [x0 + k, y1], [x0, cy])
  } else if (glyph === 'shield') {
    const k = bh * 0.34
    pts.push([x0, y0 + k], [x0 + k, y0], [x1 - k, y0], [x1, y0 + k], [x1, y1], [x0, y1])
  } else { // dead：梯形，窄边朝上
    const k = bw * 0.16
    pts.push([x0 + k, y0], [x1 - k, y0], [x1, y1], [x0, y1])
  }
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

/** seed 本地生成的房间 → MapLayout（含矩形尺寸，朝向由 rotY 决定）。
 *  显示布局采用 fxdyj scpslmaps 方案：核心区（HCZ/EZ）坐标取反镜像，
 *  LCZ 平移对齐到核心区上方（整格对齐 + 30 单位间隔），三区域互不重叠。
 *  原始世界坐标（x/z/y）保留用于玩家定位（楼层由 y 区分）。 */
function layoutFromGen(rooms: SpawnedRoom[]): MapLayout {
  const gs = MAP_DATA.grid_scale
  const GAP_UNITS = 30 // fxdyj 区域间隔
  const out: MapRoom[] = rooms.map((r) => {
    const { gw, gd } = shapeGridSize(r.shape)
    const rotNorm = ((r.rotY % 180) + 180) % 180
    const horizontal = rotNorm < 45 || rotNorm > 135
    const w = horizontal ? gw * gs : gd * gs
    const d = horizontal ? gd * gs : gw * gs
    return {
      name: roomLabel(r.name, r.shape),
      rawName: r.name,
      zone: r.zone,
      shape: r.shape,
      glyph: r.name === 'Unnamed' ? 'corridor' : (GLYPH_BY_NAME[r.name] ?? 'rect'),
      isCorridor: r.name === 'Unnamed',
      ax: r.worldX - w / 2,
      az: r.worldZ - d / 2,
      aw: w,
      ad: d,
      grid_scale: gs,
      x: r.worldX, z: r.worldZ, y: r.worldY, w, d,
      conn: r.conn,
    }
  })

  // 1) 显示坐标：核心区镜像，LCZ 原样
  for (const r of out) {
    if (r.zone === 'LightContainment') { r.rx = r.x; r.rz = r.z }
    else { r.rx = -r.x; r.rz = -r.z }
  }
  // 镜像后连接方向同步取反（LCZ 不变）
  for (const r of out) {
    if (r.zone === 'LightContainment') continue
    r.conn = (r.conn ?? []).map((c) => ({ dx: -c.dx, dz: -c.dz }))
  }

  // 2) LCZ 平移到核心区上方（fxdyj prepareRooms）
  const bbox = (list: MapRoom[]) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const r of list) {
      const rx = r.rx ?? r.x, rz = r.rz ?? r.z
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx)
      minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz)
    }
    return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
  }
  const core = out.filter((r) => r.zone !== 'LightContainment')
  const light = out.filter((r) => r.zone === 'LightContainment')
  let lightShift: { dx: number; dz: number } | undefined
  if (core.length > 0 && light.length > 0) {
    const coreBox = bbox(core)
    const rawLight = bbox(light)
    const dx = Math.round((coreBox.cx - rawLight.cx) / gs) * gs
    const dz = Math.round(((coreBox.maxZ + GAP_UNITS) - rawLight.minZ) / gs) * gs
    lightShift = { dx, dz }
    for (const r of light) { r.rx = (r.rx ?? 0) + dx; r.rz = (r.rz ?? 0) + dz }
  }

  // 3) 边界（显示坐标）
  const bb = bbox(out)
  return {
    ready: true,
    count: out.length,
    bounds: { min_x: bb.minX, max_x: bb.maxX, min_z: bb.minZ, max_z: bb.maxZ },
    rooms: out,
    lightShift,
  }
}

/** 常用 RoomType：[枚举名, 中文名]。 */
const ROOM_TYPES: [string, string][] = [
  ['Lcz173', 'LCZ-173'], ['Lcz939', 'LCZ-939'], ['Lcz914', 'LCZ-914'], ['Lcz012', 'LCZ-012'],
  ['LczAirLock', 'LCZ 气闸'], ['LczArmory', 'LCZ 军械库'], ['LczCheckpointA', 'LCZ 检查点A'],
  ['LczCheckpointB', 'LCZ 检查点B'], ['LczClassDSpawn', 'LCZ D级出生'], ['LczGlassBox', 'LCZ 玻璃箱'],
  ['LczGreenhouse', 'LCZ 温室'], ['LczHid', 'LCZ HID'], ['LczPlants', 'LCZ 植物'], ['LczToilets', 'LCZ 厕所'],
  ['Hcz049', 'HCZ-049'], ['Hcz079', 'HCZ-079'], ['Hcz096', 'HCZ-096'], ['Hcz106', 'HCZ-106'],
  ['Hcz079Testing', 'HCZ-079测试'], ['HczArmory', 'HCZ 军械库'], ['HczCheckpointA', 'HCZ 检查点A'],
  ['HczCheckpointB', 'HCZ 检查点B'], ['HczEzCheckpoint', 'HCZ-EZ检查点'], ['HczNuke', 'HCZ 核弹房'],
  ['HczServers', 'HCZ 服务器'], ['HczTesla', 'HCZ 特斯拉'], ['HczWarhead', 'HCZ 核弹'],
  ['EzConference', 'EZ 会议室'], ['EzEvacuation', 'EZ 疏散区'], ['EzGateA', 'EZ A门'], ['EzGateB', 'EZ B门'],
  ['EzIntercom', 'EZ 广播室'], ['EzOffice', 'EZ 办公室'], ['EzPcs', 'EZ 电脑房'],
  ['EzRedRoom', 'EZ 红房'], ['EzShelter', 'EZ 避难所'], ['Surface', '地表'],
]

/** 常用 DoorType：[枚举名, 中文名]。 */
const DOOR_TYPES: [string, string][] = [
  ['GateA', 'A大门'], ['GateB', 'B大门'], ['CheckpointLczA', 'LCZ检查点A'], ['CheckpointLczB', 'LCZ检查点B'],
  ['CheckpointEzHcz', 'EZ-HCZ检查点'], ['HczEzCheckpoint', 'HCZ-EZ检查点'], ['EntranceCheckpoint', '入口检查点'],
  ['HczArmory', 'HCZ军械库'], ['LczArmory', 'LCZ军械库'], ['Scp173Gate', 'SCP-173门'],
  ['Scp914Gate', 'SCP-914门'], ['Scp106Primary', 'SCP-106主门'], ['Scp106Secondary', 'SCP-106次门'],
  ['Scp096', 'SCP-096门'], ['Scp049Gate', 'SCP-049门'], ['Scp049Armory', 'SCP-049军械库'],
  ['Scp330', 'SCP-330门'], ['SurfaceGate', '地表大门'], ['EscapePrimary', '主逃生口'], ['EscapeSecondary', '次逃生口'],
  ['LczWc', 'LCZ厕所'], ['Scp330Chamber', 'SCP-330室'],
]

/** 电梯类型：[枚举名/ElevatorGroup 名, 中文名]（与 SLDataAPI /control/map/facility elevators 契约一致）。
 *  核弹电梯按组拆分 Nuke01/Nuke02 两架；LiftA/LiftB 不存在（权威枚举仅 LczA/LczB）。 */
const ELEVATOR_TYPES: [string, string][] = [
  ['Nuke01', '核弹电梯 1 号'], ['Nuke02', '核弹电梯 2 号'],
  ['Scp049', 'SCP-049电梯'],
  ['GateA01', 'A大门电梯 1 号'], ['GateA02', 'A大门电梯 2 号'], ['GateB', 'B大门电梯'],
  ['LczA01', 'LCZ-A电梯 1 号'], ['LczA02', 'LCZ-A电梯 2 号'],
  ['LczB01', 'LCZ-B电梯 1 号'], ['LczB02', 'LCZ-B电梯 2 号'],
  ['ServerRoom', '服务器房电梯'],
]

/** 门/电梯目标范围：type=指定类型，all=全部，all_not_list=除已列出类型外的所有。 */
type MapScope = 'type' | 'all' | 'all_not_list'

const ZONE_COLOR: Record<string, string> = {
  LightContainment: '#3a7bd5',
  HeavyContainment: '#c0392b',
  Entrance: '#27ae60',
  Surface: '#7f8c8d',
}

const teamColor: Record<Team, string> = {
  'D-Class': '#FFC107',
  // 混沌分裂者：绿色（区别于 D 级黄色）
  Chaos: '#2ECC71',
  Foundation: '#ffffff',
  SCP: '#FF3B30',
  Spectator: '#888888',
  Unknown: '#888888',
}

/** 世界坐标 (x,z) → SVG 坐标投影器（统一缩放比例，房间尺寸与中心点用同一 scale）。 */
function makeProjector(
  bounds: MapLayout['bounds'], W: number, H: number,
): { scale: number; toSvg: (x: number, z: number) => { sx: number; sy: number } } {
  const pad = 16
  const bw = Math.max(1, bounds.max_x - bounds.min_x)
  const bh = Math.max(1, bounds.max_z - bounds.min_z)
  const scale = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh)
  const ox = (W - bw * scale) / 2 - bounds.min_x * scale
  const oy = (H - bh * scale) / 2 - bounds.min_z * scale
  return {
    scale,
    toSvg: (x, z) => ({ sx: ox + x * scale, sy: oy + z * scale }),
  }
}

/** 玩家坐标 → 所在房间（fxdyj closestRoomTo：XZ 距离 + Y 楼层差权重）。
 *  SL 中 LCZ/HCZ/EZ 上下分层（y 不同），x/z 大量重叠，
 *  矩形包含会匹配到错误楼层 —— 用距离判定即可由 y 权重天然区分。
 *  y 权重 1.0：楼层差 100+ 直接隔离——地表玩家（y≈300，无布局房间）
 *  不会再被匹配到地下房间（旧权重 0.2 时 195×0.2=39 < XZ 距离，地表玩家
 *  会错匹配到 LCZ/HCZ 房间——正是"玩家位置不对版"的根因）。 */
function closestRoomTo(
  px: number, py: number, pz: number, rooms: MapRoom[],
): MapRoom | null {
  // 地表（y>200）：布局无地表房间，返回 null（显示"地表"）
  if (py > 200) return null
  let best: MapRoom | null = null
  let bestD = Infinity
  for (const r of rooms) {
    const d = Math.hypot((r.x ?? 0) - px, (r.z ?? 0) - pz) + Math.abs((r.y ?? 0) - py)
    if (d < bestD) { bestD = d; best = r }
  }
  return best
}

/** 玩家世界坐标 → 显示坐标（与 layoutFromGen 的镜像/平移规则一致）。 */
function playerDisplayPos(
  px: number, pz: number, room: MapRoom | null,
  lightShift?: { dx: number; dz: number },
): { rx: number; rz: number } {
  if (room?.zone === 'LightContainment') {
    return { rx: px + (lightShift?.dx ?? 0), rz: pz + (lightShift?.dz ?? 0) }
  }
  return { rx: -px, rz: -pz }
}

/** 区域筛选：全部 / LCZ / HCZ / 办公区（fxdyj 布局三区分离，可同时显示）。 */
const ZONE_FILTERS = ['All', 'LightContainment', 'HeavyContainment', 'Entrance'] as const
type ZoneFilter = typeof ZONE_FILTERS[number]

const ZONE_FILTER_LABEL: Record<ZoneFilter, TKey> = {
  All: 'map.zone.all',
  LightContainment: 'map.zone.lcz',
  HeavyContainment: 'map.zone.hcz',
  Entrance: 'map.zone.ez',
}

/** 坐标文本：(x, y, z) 整数。 */
function fmtPos(p: { x?: number; y?: number; z?: number }): string {
  return `(${Math.round(p.x ?? 0)}, ${Math.round(p.y ?? 0)}, ${Math.round(p.z ?? 0)})`
}

export default function Map() {
  const t = useT()
  const { server, control, tokenConfigured } = useControlSource()
  const mutation = useControlMutation()
  const queryClient = useQueryClient()
  const { data: serverData } = useServerQuery()

  const [selectedRoom, setSelectedRoom] = useState<MapRoom | null>(null)
  const [doorType, setDoorType] = useState('GateA')
  const [doorScope, setDoorScope] = useState<MapScope>('type')
  const [elevType, setElevType] = useState('GateA01')
  const [elevScope, setElevScope] = useState<MapScope>('type')
  const [elevLevel, setElevLevel] = useState(0)
  const [roomType, setRoomType] = useState('Hcz106')
  const [lightDur, setLightDur] = useState(30)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('All')

  const canRun = !!control
  const busy = mutation.isPending

  // 1) 轻量查询：只拿回合种子（30s 轮询检测新回合）
  const seedQuery = useQuery({
    queryKey: ['control', server?.id, 'map', 'seed'],
    enabled: canRun,
    refetchInterval: 30_000,
    queryFn: makeControlQueryFn<{ ready: boolean; seed: number }>(control!, '/control/map/seed', {}),
  })
  // 1.5) 设施状态快照（SLDataAPI 2.6.x /control/map/status，只读）
  const statusQuery = useQuery({
    queryKey: ['control', server?.id, 'map', 'status'],
    enabled: canRun,
    refetchInterval: 30_000,
    queryFn: makeControlQueryFn<MapStatusResult>(control!, '/control/map/status', {}),
  })
  const facilityStatus = statusQuery.data
  // seed 存在即用：前端布局由 seed 本地算法生成，不依赖服务器端布局缓存
  // （ready=false 仅表示服务器 /control/map layout 未采集成功——新装服务器未开始过
  //  回合或采集失败时如此——但 seed 本身有效，地图照样可以本地还原）
  const seed = seedQuery.data?.seed ?? null

  // 2) seed 已知 → 纯本地算法生成完整布局（不请求任何房间数据）
  const layout = useMemo<MapLayout | null>(() => {
    if (seed == null) return null
    return layoutFromGen(generateLayout(seed))
  }, [seed])

  const players = serverData?.players.filter((p) => p.x !== undefined && p.z !== undefined) ?? []

  // 区域筛选后的房间 / 玩家 / 边界（'All' 显示 fxdyj 布局全图；单选区域放大查看）
  const filteredRooms = useMemo(() => {
    if (!layout?.ready) return []
    if (zoneFilter === 'All') return layout.rooms
    return layout.rooms.filter((r) => r.zone === zoneFilter)
  }, [layout, zoneFilter])

  const filteredBounds = useMemo<MapLayout['bounds'] | null>(() => {
    if (!layout?.ready) return null
    const rooms = filteredRooms
    if (rooms.length === 0) return null
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const r of rooms) {
      const rx = r.rx ?? r.x ?? 0, rz = r.rz ?? r.z ?? 0
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx)
      minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz)
    }
    return { min_x: minX, max_x: maxX, min_z: minZ, max_z: maxZ }
  }, [layout, filteredRooms])

  const filteredPlayers = useMemo(() => {
    if (!layout?.ready) return []
    if (zoneFilter === 'All') return players
    return players.filter((p) => {
      const room = closestRoomTo(p.x ?? 0, p.y ?? 0, p.z ?? 0, layout.rooms)
      return room?.zone === zoneFilter
    })
  }, [players, layout, zoneFilter])

  const W = 1400
  const H = 980

  // 臂式渲染结构（fxdyj 同款几何）：房间中心 body + 各连接方向的臂。
  // body 0.88×0.62 格（< 1 格间距）→ 相邻房间不再重叠，
  // 臂 0.44 格宽、从中心伸出半格 + 0.6px → 相邻房间的臂在中点对接，
  // T 型路口/十字路口的连接清晰可见（旧参数 body 1.15 格把 0.5 格长的臂整个盖住）。
  const roomParts = useMemo(() => {
    if (!layout?.ready || !filteredBounds) return []
    const { scale, toSvg } = makeProjector(filteredBounds, W, H)
    const cell = Math.max(15 * scale, 12) // 格像素
    const armW = Math.max(0.44 * cell, 4)
    const bodyW = Math.max(0.88 * cell, 10)
    const bodyH = Math.max(0.62 * cell, 8)
    const len = cell / 2 + 0.6 // 臂长 = 半格 + 0.6px（对接无缝隙）
    return filteredRooms.map((r) => {
      const { sx, sy } = toSvg(r.rx ?? r.x ?? 0, r.rz ?? r.z ?? 0)
      const glyph = r.glyph ?? 'rect'
      const noBody = glyph === 'corridor' || glyph === 'pass'
      const arms = (r.conn ?? []).map((c) => {
        if (c.dx !== 0) return { x: sx + (c.dx > 0 ? 0 : -len), y: sy - armW / 2, w: len, h: armW }
        return { x: sx - armW / 2, y: sy + (c.dz > 0 ? 0 : -len), w: armW, h: len }
      })
      // body 形状（fxdyj bodyPath 同款）：circle 固定 0.42 格半径；
      // octagon/hex/shield/dead 多边形；gate 小圆角；默认 0.11 格圆角。
      const shape = noBody
        ? { kind: 'none' as const }
        : glyph === 'circle'
          ? { kind: 'circle' as const, r: 0.42 * cell }
          : glyph === 'gate'
            ? { kind: 'roundrect' as const, rx: 0.04 * cell }
            : glyph === 'octagon' || glyph === 'hex' || glyph === 'shield' || glyph === 'dead'
              ? { kind: 'poly' as const, points: polyPoints(glyph, sx, sy, bodyW, bodyH, cell) }
              : { kind: 'roundrect' as const, rx: 0.11 * cell }
      return {
        room: r,
        cx: sx,
        cy: sy,
        bw: noBody ? armW : bodyW,
        bh: noBody ? armW : bodyH,
        arms,
        shape,
      }
    })
  }, [layout, filteredRooms, filteredBounds])

  function mapAction(body: unknown, okText: string) {
    setResult(null)
    void mutation.mutateAsync({ path: '/control/map/facility', body })
      .then(() => {
        setResult({ ok: true, text: okText })
        return queryClient.invalidateQueries({ queryKey: ['control', server?.id, 'map'] })
      })
      .catch((e: unknown) => {
        setResult({ ok: false, text: describeControlError(e, t) })
      })
  }

  return (
    <PageStub code="M-08" title={t('nav.map')}>
      <div className="flex h-full flex-col space-y-3">
        <ControlNotice show={!tokenConfigured} />

        {result && (
          <div
            className={`border px-3 py-2 font-mono text-[11px] ${
              result.ok
                ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe'
                : 'border-scp-err/40 bg-scp-err/10 text-scp-err'
            }`}
          >
            {result.ok ? '✓ ' : '✗ '}{result.text}
          </div>
        )}

        <div className="grid grid-cols-12 gap-3">
          {/* 地图主体 */}
          <section className="col-span-12 xl:col-span-8 flex min-h-0 flex-col border border-ink-border bg-ink-deep">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-border px-3 py-2">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                <MapIcon size={12} className="text-scp-safe" /> {t('map.title')}
              </span>
              {/* 区域筛选 */}
              <div className="flex flex-wrap items-center gap-1">
                {ZONE_FILTERS.map((z) => (
                  <button
                    key={z}
                    onClick={() => setZoneFilter(z)}
                    disabled={!layout?.ready}
                    className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors disabled:opacity-40 ${
                      zoneFilter === z
                        ? 'border-inverse bg-inverse text-ink'
                        : 'border-ink-border text-ink-mute hover:border-inverse hover:text-foreground'
                    }`}
                  >
                    {t(ZONE_FILTER_LABEL[z])}
                  </button>
                ))}
              </div>
            </div>

            {seedQuery.isError && (
              <p className="p-4 font-mono text-[11px] text-scp-err">
                ✗ {seedQuery.error instanceof Error ? seedQuery.error.message : String(seedQuery.error)}
              </p>
            )}
            {!seedQuery.isError && seedQuery.data?.ready === false && seed == null && (
              <p className="p-4 font-mono text-[11px] text-ink-mute">{t('map.notReady')}</p>
            )}
            {!seedQuery.isError && seed == null && !seedQuery.data && (
              <div className="flex items-center gap-2 p-4 font-mono text-[11px] text-ink-mute">
                <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
              </div>
            )}

            {layout?.ready && (
              <div className="relative min-h-[600px] flex-1 overflow-auto bg-ink">
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="min-h-[600px] w-full"
                  preserveAspectRatio="xMidYMid meet"
                >
                  {/* 房间（臂式渲染：中心体 + 连接臂，走廊不再与相邻房间重叠） */}
                  {roomParts.map(({ room, cx, cy, bw, bh, arms, shape }, i) => {
                    const color = ZONE_COLOR[room.zone] ?? '#555'
                    const selected = selectedRoom === room
                    const fill = selected ? 0.55 : 0.3
                    const bodyProps = {
                      fill: color,
                      fillOpacity: fill,
                      stroke: selected ? '#ffffff' : color,
                      strokeOpacity: 0.9,
                      strokeWidth: selected ? 2 : 1.2,
                    }
                    return (
                      <g
                        key={`${room.name}-${i}`}
                        onClick={() => setSelectedRoom(selected ? null : room)}
                        className="cursor-pointer"
                      >
                        {/* 连接臂 */}
                        {arms.map((a, j) => (
                          <rect
                            key={j}
                            x={a.x} y={a.y} width={a.w} height={a.h}
                            fill={color}
                            fillOpacity={fill}
                            stroke={selected ? '#ffffff' : color}
                            strokeOpacity={0.9}
                            strokeWidth={selected ? 2 : 1.2}
                          />
                        ))}
                        {/* 房间体（fxdyj bodyPath 形状：corridor/pass 无体画中心方块） */}
                        {shape.kind === 'none' ? (
                          <rect
                            x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh}
                            {...bodyProps}
                          />
                        ) : shape.kind === 'circle' ? (
                          <ellipse cx={cx} cy={cy} rx={shape.r} ry={shape.r} {...bodyProps} />
                        ) : shape.kind === 'poly' ? (
                          <polygon points={shape.points} {...bodyProps} />
                        ) : (
                          <rect
                            x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh}
                            rx={shape.rx}
                            {...bodyProps}
                          />
                        )}
                        {/* 房间名：字号受房间宽高限制，永不超出房间边 */}
                        {(() => {
                          const label = room.name.replace(/^(\w{3})_?/, '$1 ')
                          // 字号 = min(0.36×房间最小边, 房间宽/(字数×0.62)) —— 保证文字宽度 ≤ 房间宽
                          const fontByBox = 0.36 * Math.min(bw, bh)
                          const fontByLen = bw / (Math.max(1, label.length) * 0.62)
                          const fontSize = Math.max(6, Math.min(fontByBox, fontByLen))
                          const maxChars = Math.max(2, Math.floor(bw / (0.62 * fontSize)))
                          const display = label.length > maxChars
                            ? label.slice(0, maxChars - 1) + '…'
                            : label
                          return (
                            <text
                              x={cx} y={cy}
                              textAnchor="middle" dominantBaseline="middle"
                              fontSize={fontSize}
                              fill="#e8e8e8"
                              stroke="#000"
                              strokeWidth={Math.max(0.5, fontSize * 0.06)}
                              paintOrder="stroke"
                              pointerEvents="none"
                            >
                              {display}
                            </text>
                          )
                        })()}
                      </g>
                    )
                  })}
                  {/* 玩家（按当前筛选区域显示；坐标经镜像/平移映射到显示布局） */}
                  {filteredPlayers.map((p) => {
                    if (!filteredBounds) return null
                    const room = layout?.ready
                      ? closestRoomTo(p.x ?? 0, p.y ?? 0, p.z ?? 0, layout.rooms)
                      : null
                    const { rx, rz } = playerDisplayPos(p.x ?? 0, p.z ?? 0, room, layout?.lightShift)
                    const { sx, sy } = makeProjector(filteredBounds, W, H).toSvg(rx, rz)
                    return (
                      <g key={p.nickname} pointerEvents="none">
                        <circle cx={sx} cy={sy} r={7} fill={teamColor[p.team]} stroke="#000" strokeWidth={1.5}>
                          <title>{`${p.nickname} ${fmtPos(p)}`}</title>
                        </circle>
                        <text
                          x={sx + 10} y={sy + 3}
                          fontSize={10}
                          fill="#fff"
                          stroke="#000" strokeWidth={0.5} paintOrder="stroke"
                        >
                          {p.nickname}
                        </text>
                      </g>
                    )
                  })}
                </svg>
                <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-[9px] text-ink-mute">
                  // {t('map.selectRoom')}
                </p>
              </div>
            )}
          </section>

          {/* 控制面板（侧栏） */}
          <section className="col-span-12 xl:col-span-4 space-y-3">
            {/* 设施状态快照（/control/map/status，只读） */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                  {t('map.status')}
                </span>
                {statusQuery.isFetching && <Loader2 size={11} className="animate-spin text-ink-mute" />}
              </div>
              <p className="mt-1 font-mono text-[9px] text-ink-mute">{t('map.statusHint')}</p>

              {statusQuery.isError && (
                <p className="mt-2 font-mono text-[10px] text-ink-mute">
                  {t('map.statusLoadFailed')}
                </p>
              )}
              {facilityStatus && (
                <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
                  {facilityStatus.round && (
                    <>
                      <StatusCell label={t('map.statusRound')} value={facilityStatus.round.started ? `${facilityStatus.round.duration_seconds}s` : t('map.statusNone')} />
                      <StatusCell label={t('map.statusDeaths')} value={String(facilityStatus.round.total_deaths ?? 0)} />
                      <StatusCell label={t('map.statusSurvivingScps')} value={String(facilityStatus.round.surviving_scps ?? 0)} />
                      <StatusCell label={t('map.statusEscapedD')} value={String(facilityStatus.round.escaped_class_d ?? 0)} />
                      <StatusCell label={t('map.statusEscapedS')} value={String(facilityStatus.round.escaped_scientists ?? 0)} />
                      <StatusCell label={t('map.statusPlayers')} value={`${facilityStatus.round.players ?? 0}`} />
                    </>
                  )}
                  {facilityStatus.decontamination && (
                    <StatusCell label={t('map.statusDecon')} value={facilityStatus.decontamination.is_decontaminating ? facilityStatus.decontamination.status : t('map.statusNone')} />
                  )}
                  {facilityStatus.generators && (
                    <StatusCell label={t('map.statusGen')} value={`${facilityStatus.generators.engaged}/${facilityStatus.generators.total}`} />
                  )}
                  {facilityStatus.warhead && (
                    <StatusCell label={t('map.statusWarhead')} value={facilityStatus.warhead.in_progress ? (facilityStatus.warhead.time_until_detonation != null ? `${Math.round(facilityStatus.warhead.time_until_detonation)}s` : 'ON') : facilityStatus.warhead.detonated ? 'DETONATED' : t('map.statusNone')} />
                  )}
                  {facilityStatus.scp914 && (
                    <StatusCell label={t('map.status914')} value={facilityStatus.scp914.knob} />
                  )}
                  {facilityStatus.holiday && (
                    <>
                      <StatusCell label={t('map.statusHoliday')} value={holidayLabel(facilityStatus.holiday.active_holiday, t)} />
                      <StatusCell label={t('map.statusCandyPool')} value={facilityStatus.holiday.candy_pool} />
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 玩家定位列表（坐标 + 所在房间/区域） */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                {t('map.players')} — {filteredPlayers.length}
              </span>
              <div className="mt-3 max-h-72 space-y-1 overflow-auto">
                {filteredPlayers.length === 0 && (
                  <p className="font-mono text-[10px] text-ink-mute">// {t('players.empty')}</p>
                )}
                {filteredPlayers.map((p) => {
                  const room = layout?.ready
                    ? closestRoomTo(p.x ?? 0, p.y ?? 0, p.z ?? 0, layout.rooms)
                    : null
                  return (
                    <div
                      key={p.nickname}
                      className="flex items-center justify-between gap-2 border-b border-ink-border/60 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: teamColor[p.team] }}
                        />
                        <span className="truncate font-mono text-[10px] text-foreground">{p.nickname}</span>
                        <span className="shrink-0 font-mono text-[9px] text-ink-mute">
                          {room ? room.name : ((p.y ?? 0) > 200 ? t('map.zone.surface') : t('map.zone.pocket'))}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-ink-mute">{fmtPos(p)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 选中房间灯光 */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                {t('map.lights')}
              </span>
              <div className="mt-3 space-y-2">
                {selectedRoom ? (
                  <p className="font-mono text-[11px] text-foreground">
                    {selectedRoom.name}
                    <span className="text-ink-mute"> · {selectedRoom.zone}</span>
                  </p>
                ) : (
                  <select
                    value={roomType}
                    onChange={(e) => setRoomType(e.target.value)}
                    disabled={!canRun}
                    className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                  >
                    {ROOM_TYPES.map(([name, label]) => (
                      <option key={name} value={name}>{name} · {label}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={lightDur}
                    onChange={(e) => setLightDur(Number(e.target.value))}
                    disabled={!canRun || busy}
                    placeholder={t('map.lightsDuration')}
                    className="w-20 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                  />
                  <ActionBtn
                    disabled={!canRun || busy || (selectedRoom?.isCorridor ?? false)}
                    onClick={() => mapAction({
                      action: 'lights',
                      // 必须用原始 RoomType 枚举名（name 是中文显示名，Enum.TryParse 会失败）
                      room_type: selectedRoom ? (selectedRoom.rawName ?? selectedRoom.name) : roomType,
                      lights_off: true,
                      duration: lightDur,
                    }, `lights off ${selectedRoom?.name ?? roomType}`)}
                  >
                    {t('map.lightsOff')}
                  </ActionBtn>
                  <ActionBtn
                    disabled={!canRun || busy || (selectedRoom?.isCorridor ?? false)}
                    onClick={() => mapAction({
                      action: 'lights',
                      room_type: selectedRoom ? (selectedRoom.rawName ?? selectedRoom.name) : roomType,
                      lights_off: false,
                    }, `lights on ${selectedRoom?.name ?? roomType}`)}
                  >
                    {t('map.lightsOn')}
                  </ActionBtn>
                </div>
              </div>
            </div>

            {/* 门控制 */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                {t('map.doors')}
              </span>
              <div className="mt-3 space-y-2">
                <select
                  value={doorScope}
                  onChange={(e) => setDoorScope(e.target.value as MapScope)}
                  disabled={!canRun}
                  className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                >
                  <option value="type">{t('map.scope.type')}</option>
                  <option value="all">{t('map.scope.all')}</option>
                  <option value="all_not_list">{t('map.scope.allNotList')}</option>
                </select>
                {doorScope === 'type' && (
                  <select
                    value={doorType}
                    onChange={(e) => setDoorType(e.target.value)}
                    disabled={!canRun}
                    className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                  >
                    {DOOR_TYPES.map(([name, label]) => (
                      <option key={name} value={name}>{name} · {label}</option>
                    ))}
                  </select>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => mapAction({ action: 'doors', scope: doorScope, door_type: doorType, lock_door: true }, `lock ${doorScope === 'type' ? doorType : doorScope}`)}
                  >
                    {t('map.lock')}
                  </ActionBtn>
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => mapAction({ action: 'doors', scope: doorScope, door_type: doorType, lock_door: false }, `unlock ${doorScope === 'type' ? doorType : doorScope}`)}
                  >
                    {t('map.unlock')}
                  </ActionBtn>
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => mapAction({ action: 'doors', scope: doorScope, door_type: doorType, open_door: true }, `open ${doorScope === 'type' ? doorType : doorScope}`)}
                  >
                    {t('map.open')}
                  </ActionBtn>
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => mapAction({ action: 'doors', scope: doorScope, door_type: doorType, open_door: false }, `close ${doorScope === 'type' ? doorType : doorScope}`)}
                  >
                    {t('map.close')}
                  </ActionBtn>
                </div>
              </div>
            </div>

            {/* 电梯控制（需游戏服 SLDataAPI 支持 elevators 动作） */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                {t('map.elevators')}
              </span>
              <div className="mt-3 space-y-2">
                <select
                  value={elevScope}
                  onChange={(e) => setElevScope(e.target.value as MapScope)}
                  disabled={!canRun}
                  className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                >
                  <option value="type">{t('map.scope.type')}</option>
                  <option value="all">{t('map.scope.all')}</option>
                </select>
                {elevScope === 'type' && (
                  <select
                    value={elevType}
                    onChange={(e) => setElevType(e.target.value)}
                    disabled={!canRun}
                    className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                  >
                    {ELEVATOR_TYPES.map(([name, label]) => (
                      <option key={name} value={name}>{name} · {label}</option>
                    ))}
                  </select>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => mapAction({ action: 'elevators', scope: elevScope, elevator_type: elevType, command: 'up' }, `elev up ${elevScope === 'type' ? elevType : elevScope}`)}
                  >
                    {t('map.elevatorUp')}
                  </ActionBtn>
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => mapAction({ action: 'elevators', scope: elevScope, elevator_type: elevType, command: 'down' }, `elev down ${elevScope === 'type' ? elevType : elevScope}`)}
                  >
                    {t('map.elevatorDown')}
                  </ActionBtn>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={elevLevel}
                    onChange={(e) => setElevLevel(e.target.value === '' ? 0 : Number(e.target.value))}
                    disabled={!canRun || busy}
                    placeholder={t('map.elevatorLevel')}
                    className="w-16 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                  />
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => mapAction({ action: 'elevators', scope: elevScope, elevator_type: elevType, command: 'send', level: elevLevel }, `elev send ${elevLevel} ${elevScope === 'type' ? elevType : elevScope}`)}
                  >
                    {t('map.elevatorSend')}
                  </ActionBtn>
                </div>
              </div>
            </div>

            {/* 图例 */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                {t('map.rooms')}
              </span>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {([['LightContainment', t('map.zone.lcz')], ['HeavyContainment', t('map.zone.hcz')],
                  ['Entrance', t('map.zone.ez')], ['Surface', t('map.zone.surface')]] as const).map(([zone, label]) => (
                  <div key={zone} className="flex items-center gap-2 font-mono text-[10px] text-ink-mute">
                    <span
                      className="inline-block h-3 w-3 border"
                      style={{ backgroundColor: ZONE_COLOR[zone], opacity: 0.5 }}
                    />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {busy && (
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            <Loader2 size={12} className="animate-spin" /> {t('common.sync')}
          </div>
        )}
      </div>
    </PageStub>
  )
}

function ActionBtn({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="border border-ink-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** 设施状态快照的小单元格（标签 + 值）。 */
function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink-border px-2 py-1.5">
      <span className="block truncate text-[8px] uppercase tracking-wider text-ink-mute">{label}</span>
      <span className="block truncate text-[11px] text-foreground">{value}</span>
    </div>
  )
}
