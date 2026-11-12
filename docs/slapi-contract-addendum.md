# SLDataAPI 契约变更（平台端已实现，待游戏服侧跟进）

日期：2026-08-18 · 提出方：平台端（Foundation Console webui）

## 1. `/control/cassie` 增加字幕翻译（英文播报 + 中文字幕）

**背景**：LabAPI 新版 TTS 已忽略 `isHeld`/`isSubtitles`，游戏内不显示字幕；同时用户需要"播报英文、字幕中文"。

**请求新增字段**（其余不变）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `translation` | string（可选） | 字幕翻译文本。提供时：**语音仍播报 `message` 原文，字幕显示 `translation`**（内部用 `Cassie.MessageTranslated(message, translation, isNoisy)` 一类 API） |
| `isSubtitles` | bool（可选） | 语义：是否显示字幕（与 translation 配合，仅提示用） |

平台端已发送：`{ message, isNoisy, isHeld, isSubtitles, translation? }`（translation 非空才带）。

**实现要点**：translation 为空 → 现有行为不变；translation 非空 → MessageTranslated。注意 message 含音效代码（`PITCH_0.5` 等）时 translation 只做字幕文本，不应解析音效代码。

## 2. `/control/map/facility` 门控制：`scope` 范围字段

**背景**：现有 `door_type` 只能操作单个 DoorType，但大部分门不在 DoorType 列表里（如机关门/随机门），需要"全部"与"全部未列出"。

**请求新增字段**（可选，缺省 = 旧行为按 `door_type`）：

| 字段 | 值 | 说明 |
|---|---|---|
| `scope` | `type`（默认）/ `all` / `all_not_list` | `all`=所有已实例化的门；`all_not_list`=除 DoorType 枚举能匹配到的门之外的所有门（遍历服务器所有 Door 实例，取不在枚举映射中的） |

与 `lock_door` / `open_door` 组合使用；`scope=all|all_not_list` 时忽略 `door_type`。

**已知问题（需修复）**：当前 `action=doors` 任何请求都会导致 HTTP 连接被立即断开（STATUS=000，约 0.08s）——疑似主线程派发或异常路径问题，请优先排查（平台端实测测试服复现）。

## 3. `/control/map/facility` 新增 `elevators` 动作

**请求**：

```json
{ "action": "elevators", "scope": "type|all", "elevator_type": "GateA", "command": "up|down" }
```

| 字段 | 说明 |
|---|---|
| `elevator_type` | SCP:SL `ElevatorType` 枚举名：`Nuke` `Scp049` `GateA` `GateB` `LiftA` `LiftB` `ElA` `ElB` |
| `scope` | `all` 时操作全部电梯（忽略 elevator_type） |
| `command` | `up` / `down` |

**实现要点**：遍历 `Map.ConnectedElevators`（或等价运行时表）按类型匹配；`up`=电梯目标楼层+1（`Elevator.ElevatorStatus.Destination` 调整并 SetDirty），`down`=-1，全部走主线程派发，返回统一 `{success,message,data}`。

## 验收（平台端会按此测）

1. `cassie` 带 translation → 游戏内英文语音 + 中文字幕
2. `doors` scope=all 与 all_not_list → 正常响应不断连
3. `elevators` type/all + up/down → 正常响应
