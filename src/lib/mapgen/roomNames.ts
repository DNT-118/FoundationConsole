/**
 * 房间名中文翻译表（提取自 fxdyj scpslmaps 的房间 label 数据）。
 * 具体房间按名字映射；走廊（Unnamed）按形状区分。
 * 缺失的房间显示原名。
 */
export const ROOM_LABELS: Record<string, string> = {
  LczToilets: '卫生间',
  LczAirlock: '气闸室',
  LczComputerRoom: '电脑房',
  LczGreenhouse: '温室',
  LczCheckpointA: 'A 电梯（轻收容侧）',
  LczCheckpointB: 'B 电梯（轻收容侧）',
  LczClassDSpawn: 'D 级人员出生点',
  LczArmory: '轻型武器库',
  Lcz173: '旧 173 收容间',
  LczGlassroom: '玻璃房',
  Lcz914: 'SCP-914 收容间',
  Lcz330: '糖果屋（SCP-330）',
  HczAcroamaticAbatement: '瀑布房',
  Hcz127: 'SCP-127 收容间',
  HczWarhead: '核弹控制室',
  HczArmory: '重型武器库',
  HczRampTunnel: '斜坡',
  Hcz049: '049 / 173 收容间',
  Hcz939: 'SCP-939 收容间',
  HczWaysideIncinerator: '路边焚化炉',
  HczServers: '机房',
  HczMicroHID: '微型 HID 室',
  HczCheckpointToEntranceZone: '检查点（通往办公区）',
  HczTesla: '电网',
  HczTestroom: '老狗家',
  Hcz079: 'SCP-079 收容间',
  Hcz096: 'SCP-096 收容间',
  Hcz106: 'SCP-106 收容间',
  HczCheckpointA: 'A 电梯（重收容侧）',
  HczCheckpointB: 'B 电梯（重收容侧）',
  EzGateA: 'A 大门（地表出口）',
  EzGateB: 'B 大门（地表出口）',
  EzEvacShelter: '避难所',
  EzIntercom: '广播室',
  EzRedroom: '红房',
  EzOfficeLarge: '大型办公室',
  EzOfficeSmall: '小型办公室',
  EzOfficeStoried: '普通办公室',
  EzCollapsedTunnel: '坍塌隧道',
  EzConference: '会议室',
  EzOffice: '办公室',
  EzPcs: '电脑室',
  EzShelter: '避难所',
  EzUpstairsPcs: '楼上电脑室',
  EzDownstairsPcs: '楼下电脑室',
}

/** 走廊（Unnamed）按形状的中文名。 */
export const CORRIDOR_LABELS: Record<string, string> = {
  TShape: 'T 形路口',
  Straight: '直线走廊',
  XShape: '十字路口',
  Curve: '转角走廊',
  Endroom: '死路',
}

/** 生成房间名 → 显示名（优先中文翻译，缺失显示原名）。 */
export function roomLabel(name: string, shape: string): string {
  if (name === 'Unnamed') {
    return CORRIDOR_LABELS[shape] ?? '走廊'
  }
  return ROOM_LABELS[name] ?? name
}
