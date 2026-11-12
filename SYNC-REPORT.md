# SYNC-REPORT — FDC v0.2.0 ↔ SLDataAPI main（bb002dd，2.6.2-patch_Holiday26 之后）对齐报告

- 日期：2026-11-13
- 分支：`feat/sldataapi-sync`（改动全部留在工作区，未 commit / 未 push）
- 参考源码：`.ref/sld/`（SLDataAPI main 只读快照，未修改、未纳入版本管理）
- 范围：FDC 原对接 SLDataAPI 2.6.0 PEAK（1f6869b），本次对齐 main 现有接口；**只实现了 SLDataAPI 源码中确实存在的路由与字段，未编造任何端点**。

---

## 1. 鉴权方式对照（结论：一致，无需修改）

| 通道 | SLDataAPI main | FDC | 结论 |
|---|---|---|---|
| 数据口 `GET /get_sl_data`、`GET /plugins/adapted`、`GET /plugins/<id>/<route>` | `verify_token`：`Authorization: Bearer` / `X-SLDataAPI-Token`（`?token=` 兼容但弃用） | 平台内部 GET 注入 `Bearer <VerifyToken>`（upstream.js） | ✅ 一致 |
| 控制口 `POST /control/*`、控制 WS、语音 WS | API Key：`Authorization: Bearer` / `X-SLDataAPI-Key`；不再接受 `X-Control-Token` / `?token=` / `?key=` | POST / 控制 WS 升级 / 语音升级均注入 `Bearer <API Key>` | ✅ 一致（Bearer 为上游两种等价形式之一） |
| Key 角色 | `duty` / `admin` 模板在 `sldataapi apikey create` 时固定 | 平台不创建 Key（仅本地控制台可建），只存储并注入 | ✅ 一致 |

---

## 2. 路由对照表（SLDataAPI → FDC 支持情况）

### 2.1 数据口（GET，verify_token）

| SLDataAPI 路由 | FDC 支持情况 |
|---|---|
| `GET /get_sl_data` | **已修**：链路原有；本次补齐 2.6.x 新字段 `game_version`、`active_holiday`（类型 + normalize + 仪表盘展示） |
| `GET /plugins/adapted` | **已有** |
| `GET /plugins/<id>/<route>` | **已有** |

### 2.2 控制口（POST /control/*，API Key）

图例：**已有** = 原本就通；**已修** = 原有链路本次修正；**新增** = 本次补上前后端；**未做** = 有原因说明。

| SLDataAPI 路由 | 状态 | 说明 |
|---|---|---|
| `/control/player/data` | 已有 | 链路与白名单原有；未做专用 UI（见 §5） |
| `/control/player/role` | 已有 | 远程管理页 |
| `/control/player/effects` | 已有 | 远程管理页；节日效果（IHolidayEffect）409 已修提示 |
| `/control/player/inventory` | **新增** | 物品栏 add/remove/clear（远程管理页）；节日物品 409 友好提示 |
| `/control/player/candy` | **新增** | SCP-330 糖果（名字或 random，≤6）；409 提示含当前节日 |
| `/control/moderation/kick · ban · mute · msg` | 已有 | mute 的 `mute_scope` / `persistent` 字段本次一并补进 API 文档 |
| `/control/moderation/ban_list · ban/add · ban/revoke` | 已有 | 封禁列表页 |
| `/control/admin/teleport · admin/state` | 已有 | 远程管理页 |
| `/control/broadcast · staffchat` | 已有 | 广播面板 |
| `/control/round` | 已有 | |
| `/control/round/warhead` | 已有 | |
| `/control/round/wave` | **新增** | 远程管理页：faction（mtf/chaos）状态查询、立即重生、设置倒计时/代币 |
| `/control/dummies` | **新增** | 远程管理页：spawn（昵称/可选职业）、list（10s 轮询）、remove（单个/全部）；显示 `count/max`（上限 5，来自上游 MaxDummies） |
| `/control/map/facility` | 已有 | doors/elevators/lights（含 scope、color、flicker_seconds） |
| `/control/map/layout · seed · export` | 已有 | |
| `/control/map/status` | **新增** | 地图页"设施状态"卡片：回合统计/去污/发电机/核弹/SCP-914/节日（candy_pool） |
| `/control/cassie` | 已有 | `translation` 字段（字幕翻译）FDC 早已实现，上游 2.6 已落地 |
| `/control/console/command` | 已有 | |
| `/control/plugins` | 已有 | reload/stage/clear/apply 暂存-应用流 |
| `/control/plugins/slplayer` | 已有 | 音乐控制 |
| `/control/adapted/<plugin_id>/<action>`（内测 beta_adapted_plugin_actions） | **新增** | ① 后端：`isAllowedControlPath` 放行该前缀（插件 id 允许 `.`/`-`/`_`，两段制，拒绝 `..`，安全测试覆盖）；② 前端：插件页对 discovery 中带 `actions` 的适配插件提供动作执行 + 可选 JSON 请求体 + 结果查看 |
| `/control/files/list · read · write` | 已有 | 文件页 |
| `/control/files/stat · read_chunk · write_chunk`（内测 beta_file_root_ws） | **已有**（链路）+ 文档 | 平台白名单天然放行（通用小写段规则）；Api 页补了文档。未做分块上传/下载编辑器 UI（原因见 §5） |
| `/control/logs` | 已有 | `action=list` 文件选择器 + filter |
| `/control/reports` | 已有 | 举报管理页 |
| `/control/audit/list` | 已有 | 审计组件 |

### 2.3 控制 WS（`ws://<host>:<http_port>/control`，control_transport: ws）

| 能力 | 状态 | 说明 |
|---|---|---|
| `hello` / `ping`/`pong` / `call`/`result` 信封 | 已有 | 平台 wsHub 中继；`transport_mismatch` 自动翻转传输并重试同一次调用 |
| `subscribe_events` / `unsubscribe_events` | 已有 | 平台按引用计数聚合订阅，guest 禁订阅 |
| **事件名对齐** | **已修** | FDC 事件页原先监听 `player_joined / player_left / player_died / elevator_used / door_opened / round_started / round_ended` —— 上游 **从不推送** 这些占位名。已对齐 WsEventBridge 真实 12 种：`player_banned`、`player_kicked`、`player_escaped`、`player_role_changed`、`player_reported`、`wave_respawned`、`decontamination_started`、`generator_activated`、`scp_terminated`、`warhead_started`、`warhead_stopped`、`warhead_detonated`，并按各事件字段重写摘要文案（中英） |
| `hello.beta` / `hello.tls` / `hello.cert_fingerprint` | 未做（消费） | 平台仅识别 `hello` 类型，未向 UI 透出 TLS 指纹/内测能力列表；不影响功能（见 §5） |

### 2.4 语音（独立端口 `voice_port`，默认 8082）

| 能力 | 状态 | 说明 |
|---|---|---|
| `WS :voice_port/ws`（实时语音流） | 已有 | 平台升级代理注入 Bearer API Key；`voice_port` 来自 `/get_sl_data` |
| `GET :voice_port/status`（当前说话者 JSON） | 未做 | 语音页已用实时 speaker 帧驱动；该端点冗余（见 §5） |

### 2.5 错误码对照

| 上游错误 | 状态 | 说明 |
|---|---|---|
| `409 holiday_inactive`（data: code/feature/active_holiday/required） | **已修** | 新增 `ControlError`（src/api/controlError.ts），HTTP 与 WS 两条控制链路统一抛出；`describeControlError`（src/utils/controlHint.ts）渲染本地化提示"节日功能未开启：需要 X，当前节日为 Y"，用于物品/糖果/效果等所有控制入口 |
| `501 feature_unavailable` | **已修** | 同上，固定提示"当前游戏版本不提供该功能" |
| `426 tls_required` | **已修** | 同上，提示改走 HTTPS/WSS |
| `404 transport_mismatch`（data.code + use） | 已有 | 平台机器可读翻转（进程内记忆） |
| `403 API Key 有效但未授权该端点` | 已有 | 透传上游 message |

### 2.6 数据字段对照（/get_sl_data）

| 字段 | 状态 |
|---|---|
| `game_version` | **新增**（类型/normalize/仪表盘"游戏版本"行；旧服务端缺省显示 —） |
| `active_holiday` | **新增**（同上，节日名本地化：无/圣诞节/万圣节/愚人节） |
| `voice_port` | 已有 |
| `adapted_plugins[].actions` | **新增**（内测开启时才返回；类型 + 插件页动作 UI） |
| `players[].team` 名 | **已修**：SLDataAPI 输出 `混沌`（ChaosInsurgency）与 `其他`（OtherAlive），FDC 旧映射只有 `D级/SCP/基金会/九尾狐/观众`。现：`混沌 → D-Class`（与上游 d_count 口径一致：ClassD+Chaos 同桶）、`其他 → Unknown` |

---

## 3. 改动文件清单

### 后端（server/）
| 文件 | 改动 |
|---|---|
| `server/security.js` | `isAllowedControlPath` 放行内测 `/control/adapted/<plugin_id>/<action>`（两段、段首字母/数字、`[a-zA-Z0-9._-]` ≤64、拒绝 `..`），其余 `/control/*` 维持原严格规则 |
| `server/security.test.js` | 新增 adapted 路径用例（含 `a..b`、`../`、多段、query、大小写拒绝） |

### 前端（src/）
| 文件 | 改动 |
|---|---|
| `src/types/api.ts` | `SlServerData` 补 `game_version`/`active_holiday`；`AdaptedPluginInfo` 补 `actions`；`ControlResult` 补 `status`；新增 `DummyInfo`/`DummiesListResult`/`WaveStatusResult`/`InventoryInfo`/`CandyResult`/`MapStatusResult` |
| `src/api/normalize.ts` | 新字段归一化（旧服务端安全缺省）；teamMap 补 `混沌`/`其他` |
| `src/api/controlError.ts` | **新文件**：`ControlError`（status/code/data）+ `controlErrorFrom` + `holidayInactiveInfo` + 错误码常量 |
| `src/api/slDataApi.ts` | HTTP 控制链路业务失败抛 `ControlError` |
| `src/hooks/useControl.ts` | 统一控制入口对 `success=false` 抛 `ControlError`（WS/HTTP 两路一致） |
| `src/ws/hub.ts` | `result` 解包保留上游 `status` |
| `src/utils/controlHint.ts` | **新文件**：`describeControlError`（409/501/426 本地化）、`fill` 占位填充、`holidayLabel` 节日本地化 |
| `src/i18n/dict.ts` | 中英双语：事件键替换为 12 种真实事件 + 摘要模板；新增 wave/dummies/inventory/candy/map.status/plugins.actions/holiday.*/err.* 文案；修正 `api.verifyToken`/`api.apiKey` 鉴权说明 |
| `src/pages/Events.tsx` | 对齐真实事件名与摘要（WsEventBridge 字段） |
| `src/pages/RemoteAdmin.tsx` | 新增：重生波次（查询/立即重生/设置）、假人（spawn/list/remove/清空）、物品栏（add/remove/clear+含弹药）、SCP-330 糖果；错误统一走 `describeControlError` |
| `src/pages/Map.tsx` | 新增"设施状态"只读快照卡片（/control/map/status，30s 轮询） |
| `src/pages/Plugins.tsx` | 新增适配插件动作执行（POST /control/adapted/&lt;id&gt;/&lt;action&gt;，可选 JSON body，内测提示与结果展示） |
| `src/pages/Dashboard.tsx` | API 健康卡补"游戏版本 / 节日"两行 |
| `src/pages/Api.tsx` | 端点文档表从 23 条扩到 37 条（补 player/data、inventory、candy、admin/state、round/wave、dummies、map 全家、map/status、adapted 动作、files 内测分块等）；修正"inventory/dummies 仍未实现(501)"的过时说明与鉴权描述 |

### 测试 / 文档
| 文件 | 改动 |
|---|---|
| `tests/sldata-sync.test.mjs` | **新文件**：6 个用例（409 结构化传递、非节日错误、本地化提示渲染、2.6.x 字段与队伍映射归一化、旧服务端缺省、fill/holidayLabel） |
| `docs/ws-control-design.md` | 事件流名单更正为上游真实事件（注明旧占位名上游不推送） |
| `docs/peak-maintenance.md` | 更正"inventory/dummies 仍为 501"为当前状态，并链接本报告 |

> 新建文件均带 `Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0` 头；未引入任何新外部域名/统计脚本；未读取或创建 `server/data` 真实数据（e2e 使用临时隔离目录）。

---

## 4. 测试结果

| 命令 | 结果 |
|---|---|
| `npm ci` | ✅（工作区原先缺 node_modules） |
| `npm run typecheck`（tsc -b --noEmit） | ✅ 0 错误 |
| `npm run build`（tsc + vite build） | ✅（仅既有的 chunk >500kB 警告，与本次改动无关） |
| `npm test` → `test:syntax` | ✅ |
| `npm test` → `test:unit`（security/store/upstream/wsHub/staticFiles/totp） | ✅ 13/13 |
| `npm test` → `test:frontend` | ✅ 15/15（含本次新增 6 例） |
| `npm run test:e2e` | ✅ 34 PASS / 0 FAIL |

---

## 5. 未做项与仍需人工确认的点

**未做（有原因）**
1. **`/control/files/stat|read_chunk|write_chunk` 分块编辑器 UI**：链路通（白名单天然放行）、Api 页已文档化。原因是内测特性（`beta_file_root_ws: false` 默认关闭），且现有 HTTP `files/read|write`（1MB/512KB）已覆盖常用场景；分块上传需会话管理（upload_id/offset/sha256），待上游转正后再做 UI。
2. **WS `hello` 的 `beta`/`tls`/`cert_fingerprint` 字段消费**：平台仅用 `hello` 判定就绪；透出 TLS 指纹（pin 校验 UI）属增强项。
3. **语音 `GET :voice_port/status`**：语音页由实时 speaker 帧驱动"正在说话"状态，该 JSON 端点冗余。
4. **`/control/player/data` 专用 UI**：链路、类型、文档已通；如需"玩家档案"面板（生命/护盾/效果/TemporaryBypass）可后续加。

**需人工确认**
1. **duty Key 的 ACL**：上游 duty 模板默认不授予 `dummies/`、`player/inventory`、`player/candy`、`round/wave`（写）等端点——用 duty Key 操作时 UI 会如实显示上游 403"未授权该端点"。若希望值班可用人性化，需在游戏服 `apikey.config` 的 `endpoints_override` 放开，而非改 FDC。
2. **内测端点可用性**：`adapted/<id>/<action>` 需游戏服 `beta_adapted_plugin_actions: true` 且 Key 显式授权；文件分块需 `beta_file_root_ws: true`。未开启时 UI 显示上游 404 提示。
3. **节日链路的实测**：409 提示链路用单测覆盖（构造结构化响应），但"真实 Halloween 游戏服上 candy/inventory 的 409 → 友好提示"需测试服验收。
4. **`混沌 → D-Class` 的口径**：与上游 `d_count`（ClassD+Chaos 同桶）一致；若希望玩家列表里混沌单独显示，请反馈再调。
5. **`.ref/sld/`**：保持只读快照，未加入仓库（`.gitignore` 未改动，提交前请确认其不会被 `git add` 进去）。

---

## 6. 上游版本口径备注

- `ControlController.Handle` 的未知端点返回 `"未知控制端点（2.6 已移除旧路径别名…）"`——FDC 白名单本就只放行 RA 对齐新路径，无旧别名残留。
- 上游控制口仅接受 POST（405）；数据口仅接受 GET。平台转发方法与之严格对应。
- `X-SLDataAPI-Token` / `X-SLDataAPI-Key` 备用头 FDC 未使用（Bearer 已覆盖），如需双头兼容可再议。
