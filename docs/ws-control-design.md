# 控制接口 WebSocket 化设计方案（Foundation Console）

> 状态：Phase 1–3 已实现；2026-08-28 已适配 SLDataAPI v2.5.4 的 WS 事件流。
> 目标读者：实现者（前端 + 平台后端）。本文档给出完整协议与实现要点，实现时无需再与设计方沟通。

---

## 1. 背景与目标

**现状痛点**：

- 浏览器端对每台游戏服务器用 react-query 定时 HTTP 轮询（`useServerQuery` / `useServersOverview`），
  每个前端页面、每台服务器、每个轮询周期都产生一次 `GET /api/sl/proxy?target=...` 请求。
- 绑定 N 台服务器时，请求数 = 页面数 × N × 轮询频率，且每个请求都要穿透
  反向代理 → 平台 → HTTP 转发 → 游戏服务器，开销大、延迟抖动明显。
- 控制命令（kick/ban/命令等）走一次性 HTTP POST，本可复用连接却每次都重新建链。

**目标**：

1. 浏览器与平台之间建立**一条持久 WebSocket**，多路复用全部服务器状态与控制调用。
2. 平台对每台游戏服务器维持**单一轮询器**（无论多少个浏览器/标签页订阅），
   状态变化通过 WS 推送给所有订阅者 —— 浏览器侧不再各自轮询。
3. 控制命令通过同一 WS 以**请求/响应（reqId 关联）**方式执行，语义与现有 `/control/*` 完全一致。
4. 兼容与降级：普通状态和控制调用在 WS 不可用时回退 HTTP；事件流按插件契约仅支持 WS。

---

## 2. 架构总览

```
浏览器(每标签页一条 WS)                         平台(Node)                          游戏服务器
┌──────────────┐   wss://<平台>/api/sl/ws   ┌──────────────────────┐   HTTP(保留)    ┌──────────────┐
│ WsHub        │ ◄──────────────────────► │ 订阅表 / 轮询器表       │ ──────────────► │ SLDataAPI    │
│ (订阅/调用)   │   状态推送 + call/result   │ (每 server 一个轮询器)  │ ◄────────────── │ :8081        │
└──────────────┘                          └──────────────────────┘  (白名单+DNS校验  └──────────────┘
                                            控制调用仍走现有代理逻辑     +平台存储token注入)

语音通道不变：浏览器 WS → /api/sl/voice → 游戏服 :8082/ws（本次设计不涉及）
```

关键决策：

- **WS 只建在浏览器 ↔ 平台**。浏览器永不直连游戏服务器（凭据不出平台，沿用现有安全模型）。
- **平台 ↔ 游戏服务器暂保持 HTTP**（SLDataAPI 未做 WS 控制端点，Phase 3 可选升级）。
  性能问题的根源在浏览器侧 N×M 轮询，聚合到平台后只剩「每服务器一条轮询」。
- 平台对同一台服务器的轮询**全局去重**：多个标签页/多个用户订阅同一台服务器时，
  只跑一个轮询器，结果广播给所有订阅者（同用户多标签页、不同用户各自订阅，均适用）。
- 平台转发游戏服务器返回的**原始 JSON 字符串**（不解析、不改造），前端复用现有
  `normalizeServerData` / `normalize` 逻辑，平台零字段耦合。

---

## 3. WS 协议

- 端点：`/api/sl/ws`（与 `/api/sl/voice` 同级的 HTTP upgrade 处理）。
- 传输：**JSON 文本帧**（一条消息一个帧；`ws.send(JSON.stringify(msg))`）。
- 编码：UTF-8。消息最大 256KB（平台侧丢弃超限消息并断开）。
- 心跳：客户端每 **25s** 发 `{"type":"ping"}`，平台回 `{"type":"pong"}`；
  平台 90s 未收到任何消息则主动关闭连接（客户端应重连）。

### 3.1 消息信封

所有消息统一 `{ "type": string, ... }`，类型见下表。方向标注 B→P（浏览器→平台）与 P→B。

| type | 方向 | 字段 | 说明 |
|---|---|---|---|
| `ping` / `pong` | 双向 | — | 心跳 |
| `subscribe` | B→P | `serverIds: string[]` | 订阅一组服务器（**全量覆盖**式：每次发送即重置该连接的订阅集合；空数组=退订全部） |
| `state` | P→B | `serverId, raw: object, fetchedAt: number` | 服务器快照（`raw` 即 `/get_sl_data` 返回的原始 JSON 对象；`fetchedAt` 为平台收到的时间戳 ms）。首帧在订阅确认后**立即**发送（用最近一次缓存，无缓存则等下一次轮询） |
| `error` | P→B | `serverId, message: string` | 该服务器轮询失败（不可达/超时/接口错误）。成功后下一帧 `state` 覆盖；前端据此显示"不可达" |
| `call` | B→P | `reqId: string, serverId: string, path: string, body?: object` | 控制调用。`path` 形如 `/control/moderation/kick`；`body` 与现有 POST 体一致 |
| `result` | P→B | `reqId, serverId, ok: boolean, status?: number, data?: object, message?: string` | 控制调用结果。`ok=true` 时 `data` 为 `/control/*` 响应 JSON；`ok=false` 时 `message` 为错误（对应现有 400/403/500 文案） |
| `auth_error` | P→B | `message` | 鉴权失败（未登录/会话过期），随后平台关闭连接。前端收到后跳登录页 |
| `subscribe_events` | B→P | `serverIds: string[]` | 全量覆盖事件订阅；平台仅为这些服务器维持上游 WS 事件流 |
| `event_status` | P→B | `serverId, connected, message?` | 上游事件流连接/断开状态 |
| `event` | P→B | `serverId, event, utc, data` | SLDataAPI 实时事件；不经 HTTP 补拉历史 |

`reqId` 由浏览器生成（如 `c_${Date.now()}_${random}`），**仅需在当前连接内唯一**（前端按 reqId 关联回调，超时 25s 清理）。

### 3.2 消息示例

```jsonc
// 浏览器 → 平台：订阅两台服务器
{ "type": "subscribe", "serverIds": ["srv_abc123", "srv_def456"] }

// 平台 → 浏览器：状态推送
{ "type": "state", "serverId": "srv_abc123",
  "fetchedAt": 1786800000000,
  "raw": { "success": true, "server_name": "...", "players_count": 19, "...": "..." } }

// 浏览器 → 平台：踢人
{ "type": "call", "reqId": "c_123_456", "serverId": "srv_abc123",
  "path": "/control/moderation/kick", "body": { "target": "PlayerOne", "reason": "test" } }

// 平台 → 浏览器：结果
{ "type": "result", "reqId": "c_123_456", "serverId": "srv_abc123",
  "ok": true, "data": { "success": true, "message": "操作完成" } }
```

---

## 4. 平台端实现要点（server/server.js）

### 4.1 连接接入（复用语音通道已验证的坑）

- 在现有 `plainServer`（以及未来 HTTPS 场景的 `secureServer`）的 `upgrade` 事件里处理
  `pathname === '/api/sl/ws'`（参考 `handleVoiceUpgrade` 的实现位置）。
- **必须**在第一个 `await` 之前同步注册占位监听（`socket.on('data', () => {})`、`socket.on('error', ...)`），
  否则 Node 会在回调结束后销毁 socket（语音桥当年 1006 断连的根因）。
- 握手：读 `Sec-WebSocket-Key`，SHA1+`258EAFA5-E914-47DA-95CA-C5AB0DC85B11` → base64 → 回 101。
- 鉴权：复用 `currentUser()`（cookie `pfc_session`）——WS 握手请求带同源 cookie，无需新令牌。
  未登录 → 先按 WS 协议发一条 `auth_error` 文本帧再关闭（不要裸关）。
- 消息解析：自行实现最小 WS 帧解析/封帧（平台现有代码风格为**零第三方依赖**，
  语音桥已有帧封装代码可复用/抽公共函数；若实现者想引入 `ws` 库需说明理由）。

### 4.2 核心数据结构

```js
const wsClients = new Map()      // userId -> Set<socket>
const subs = new Map()           // serverId -> Set<socket>
const pollers = new Map()        // serverId -> { timer, inFlight:boolean, lastRaw:object|null, lastAt:number, error:string|null }
const pendingCalls = new Map()   // reqId -> { userId, serverId, path, body, socket }
```

### 4.3 订阅与轮询器生命周期

- `subscribe` 到达：校验每个 `serverId` 属于当前用户
  （`store.listServers(user.username).some(s => s.id === serverId)`），非法 id 直接忽略（不回错误）。
  更新 `subs`：从旧订阅集合中移除该连接，再按新数组加入。
- 轮询器管理（对每个 serverId）：
  - `subs.get(serverId)` 非空 且 无轮询器 → 启动：立即拉一次，然后 `setInterval`。
  - `subs.get(serverId)` 为空 → 清除轮询器（**无人订阅即停止轮询**，零订阅零流量）。
  - 拉取间隔：`clamp(server.refetchInterval, 1000, 30000)` ms（每台服务器自己的配置）。
  - 拉取实现：直接复用现有 `forwardTo`/代理逻辑（白名单 + `resolveHostChecked` + 平台存储 token 注入），
    GET `${serverBaseUrl}/get_sl_data`。**重构建议**：把 `/api/sl/proxy` 里"解析目标→校验→转发"的部分
    抽成 `async function fetchGameServer(user, server, method, path, body)` 供 HTTP 代理与轮询器共用。
  - 成功：`lastRaw`/`lastAt` 更新，向 `subs.get(serverId)` 所有连接广播 `state`
    （`fetchedAt: Date.now()`，raw 为解析后的 JSON 对象）。
  - 失败：向订阅者广播 `error`（带可读 message）；**不重试风暴**：失败时下一次 tick 正常再试即可
    （配合每服务器 1s 下限，天然限流）。
- 退订/断连：socket close → 从 `wsClients` 与所有 `subs` 中移除该 socket，触发轮询器回收。
- 内存上限：`subs`/`pendingCalls` 以连接生命周期为界；`pollers` 有订阅才存在；
  另加总连接数上限（如 2000），超出拒绝新握手。

### 4.4 控制调用（call/result）

- `call` 到达：校验 `serverId` 属当前用户 → 生成/记录 `pendingCalls[reqId]` →
  沿用现有 POST 控制路径（白名单 + DNS 校验 + 平台存储 API Key 注入；**不复用浏览器传入的凭据**）：
  `POST ${serverBaseUrl}${path}`，body 原样透传。
- 响应映射：HTTP 200 → `{ok:true, data: <解析后的JSON>}`；
  其余 → `{ok:false, status, message: <后端返回的 message>}`；网络失败 → `{ok:false, message:"目标不可达"}`。
- 并发与限流：同一连接并发 `call` 上限（如 8 个，超出回 `result{ok:false,message:"并发过多"}`）；
  每用户控制调用频率上限可选（如 5 次/秒，防误触连环操作）。现有 HTTP 控制路径的
  IP 失败锁定（ControlAuth）**保持不变**——WS 调用同样要计入失败锁定（复用同一函数，IP 取 WS 连接对端）。
- 超时：平台侧单次调用 30s 超时（对齐现有 socket 超时），超时回 `{ok:false, message:"超时"}`。

### 4.5 服务器列表变更

现有"新增/删除服务器"是 HTTP 接口（保留）。前端在变更成功后自行重发 `subscribe`；
平台无需主动推送列表变更（若后续想优化，可加 `servers_changed` 广播，Phase 1 不做）。

---

## 5. 前端实现要点（src/）

### 5.1 WsHub（新文件 `src/ws/hub.ts`，单例）

- 职责：建连/心跳/指数退避重连（1s 起，×2 至 30s 封顶，成功后复位）、
  `subscribe(serverIds)`（全量覆盖式，内部与"当前想要的订阅"合并）、
  `call(serverId, path, body)`（返回 Promise，reqId 关联，25s 超时）、
  事件分发（state/error/auth_error）。
- 触发条件：会话就绪（`authStore.ready` 且有 session）后连接；登出时断开。
- **降级开关**：连接失败或 `auth_error` 时置 `hubUnavailable` 标志，前端各查询回退现有
  HTTP 轮询路径（`useServerQuery` 原实现保留为 fallback），两套并存。
- 断线重连成功后：自动重发最近的 `subscribe`，并立刻用 `lastRaw` 缓存推送所有已订阅服务器的
  最近状态（平台在 subscribe 确认时发缓存帧即可实现）。

### 5.2 状态层（新文件 `src/ws/stateStore.ts`，zustand）

```
{
  byServer: Record<serverId, { raw?: object, state?: ServerState, error?: string, fetchedAt?: number }>,
  applyState(serverId, raw), applyError(serverId, message), clear(serverId)
}
```
- `applyState` 内调用现有 `normalizeServerData(raw, serverId)`（复用 `src/api/normalize.ts`），
  产出 `ServerState` 存进 store —— 各页面读取结构不变。
- 与 react-query 的关系：**控制类只读查询**（plugins/ban_list/logs 等）与一次性 mutation 优先走
  WS `call`；已用 react-query 的地方可保留壳（queryFn 改为 `hub.call(...)`，缓存失效逻辑不变）。

### 5.3 Hook 替换表

| 现有 | 改为 | 说明 |
|---|---|---|
| `useServerQuery()` | `useServerState(activeId)` | 读 stateStore + 订阅单台；`isFetching` 语义改为"距上次 fetchedAt 超过 1 个轮询间隔" |
| `useServersOverview()` | `useServersOverview()`（内部改为一次 `subscribe(allIds)` + 读 stateStore） | Dashboard 概览不再 N 个 HTTP query，一个订阅搞定 |
| `useControlMutation()` / `makeControlQueryFn` | 内部 `control()` 改走 `hub.call` | 签名不变，页面零改动 |

### 5.4 页面改动清单

- `hooks/useServerQuery.ts` / `hooks/useServersOverview.ts`：按上表重写（保留 HTTP fallback 分支）。
- `hooks/useControl.ts`：`control` 函数在 hub 可用时走 WS，否则走现有 `dataSource.control`。
- `api/registry.ts`、`api/slDataApi.ts`：**不动**（fallback 与 WS 的 normalize 复用其函数）。
- 其余页面**无需改动**（store 形状兼容）。

---

## 6. 兼容与降级策略

- 平台：`/api/sl/ws` 与现有 `/api/sl/proxy`、`/api/sl/voice` 并存；WS 不可用（企业代理禁 WS 等）时
  前端自动回退 HTTP 轮询，功能完整可用，仅性能回到现状。
- 浏览器：`new WebSocket()` 失败或 3 次重连失败 → `hubUnavailable=true` → fallback 生效；
  期间每 60s 重试一次 WS 连接（自动恢复推送模式）。
- 老客户端（未更新页面）不受影响：它们继续打 HTTP 接口。

---

## 7. 分阶段实施计划

**Phase 1（平台端，可独立验证）**
1. 抽取 `fetchGameServer(user, server, method, path, body)` 公共转发函数。
2. 实现 `/api/sl/ws` upgrade + 握手 + 鉴权 + 帧编解码（复用/抽公共语音桥代码）。
3. 订阅表 + 轮询器表 + 广播 + 生命周期回收。
4. `call`/`result` 通道 + 失败锁定联动。
5. 用 `wscat`/Node 脚本验证：订阅→收到 state；call →收到 result；断线→轮询器停止。

**Phase 2（前端）**
1. `ws/hub.ts` + `ws/stateStore.ts`。
2. 重写 `useServerQuery`/`useServersOverview`（含 fallback）。
3. `useControl` 接入 `hub.call`。
4. 手动回归：多服务器概览、激活切换、控制操作、刷新/断网重连、登出清理。

**Phase 3（可选，性能深挖时再做）**
- SLDataAPI 增加游戏服侧控制 WS 端点（`/ws/control`，API Key 鉴权，支持命令/事件订阅）；
- 平台轮询器改为上游 WS 长连（替代每服 HTTP 轮询），协议对齐本文 state/call 消息。
- 说明：本阶段涉及 C# 插件改动，非本方案必需项。

> **补充（v2.6.0-preview 已落地，权威规范见 SLDataAPI 的 2.6 鉴权契约）：**
> 游戏服侧 `/ws/control` 已实现，协议以 README 为准：
> - 端点 `ws://<服务器IP>:8081/control`（`/ws/control` 为别名，与 HTTP 同端口）；握手头使用 `Authorization: Bearer <api_key>`
> - 门控 `controlTransport: "ws"`；与 HTTP `/control/*` 硬互斥（ws 模式 HTTP 404，http 模式握手拒绝）；`/get_sl_data` 不受影响
> - 消息：S→C `hello`{version,endpoints}；`ping`/`pong`；C→S `call`{reqId,path,body}；S→C `result`{reqId,ok,status,data|message}（结果允许乱序）；S→C `error`
> - 限额：全局 8 连接、单连接并发 call 4（超出回 result{ok:false,status:429}）、单消息 256KB、90s 无入站断开
>
> **平台实现方注意**：
> 1. 平台上游连接器必须按上述协议对接游戏服（含 hello 校验、429 语义透传）；
> 2. 每台服务器的传输方式读取服务器记录的 `controlTransport` 字段（前端绑定服务器时选择，
>    与游戏服 config.yml 同名同值）；`ws` 时控制调用走 WS 中继、`http` 时沿用 HTTP 代理；
> 3. **状态数据仍然 HTTP 轮询**（`/get_sl_data` 没有 WS 通道）——平台每服务器一个聚合轮询器
>    推送浏览器的架构不变，控制通道与数据通道是两条独立的路径。
> 4. **上游关闭码语义**（游戏服 v2.5 加固后，与 SLDataAPI README 的码表一致）：
>
>    | 阶段 | 码 | 含义 | 平台中继应对 |
>    |---|---|---|---|
>    | 握手前（HTTP） | 400 | 请求格式非法 | 透传错误，不做重试 |
>    | 握手前（HTTP） | 401 | API Key 缺失或无效（计入 IP 失败锁定） | **不要立即重试**——进入长退避并提示用户核对 API Key |
>    | 握手前（HTTP） | 403 | API Key 有效但端点未授权 | 提示用户调整 `apikey.config` ACL，不立即重试 |
>    | 握手前（HTTP） | 404 | 端点不存在 / 未启用（controlEnabled=false 或 controlTransport≠ws） | 按配置错误处理：提示用户检查游戏服配置，不重试 |
>    | 握手前（HTTP） | 503 | 全局连接数已满（8） | 丢弃，退避重连（如 30s 后重试一次） |
>    | 会话中（WS） | 1000 | 正常关闭 | 按需重连（若业务需要常驻连接） |
>    | 会话中（WS） | 1002 | 协议错误（非法 JSON / 未知类型） | 视为实现缺陷，修客户端代码，不自动重试 |
>    | 会话中（WS） | 1003 | 不支持的数据（如二进制帧） | 同上，修代码 |
>    | 会话中（WS） | 1008 | 消息组装超时（30s 滴流防护） | 丢弃上游连接，退避重连 |
>    | 会话中（WS） | 1009 | 单消息超限（256KB） | 检查调用方消息大小，丢弃连接 |
>
> 5. **语音通道独立于控制通道**：语音上游另有 8 连接上限与 10s 握手超时。
>    特别注意：语音满载时新连接在 **TCP 层直接被关闭**（拿不到任何 WS 层错误码），
>    中继侧应把"上游握手期连接被重置"视为普通连接失败，走退避重连，不要等待 WS 错误码。
> 6. **最终契约（SLDataAPI v2.6.0-preview，取代此前所有描述）**：
>    - WS 规范地址 `ws://<host>:<http_port>/control`（`/ws/control` 为等价别名，同端口），仅接受 `Authorization: Bearer` 或 `X-SLDataAPI-Key` 请求头
>    - 传输协商为**机器可读翻转**：被拒一方收到 404，响应体
>      `{"success":false,"message":"...","data":{"code":"transport_mismatch","use":"ws|http"}}`；
>      该信号在**鉴权之前**返回、不计入失败锁定 → 平台策略：按记忆模式执行，
>      收到 mismatch 即翻转记忆并用另一传输**重试同一次调用**；连接失败（非 mismatch）清除记忆重探测
>    - 401 禁止自动重试；403 表示 Key 有效但 ACL 未授权；503/1008/1009/1002/1003/408 应对同前表
>    - 游戏服**没有 state 推送**：数据通道永远走 HTTP 聚合轮询（`verify_token` 与控制面 API Key 分轨，勿混用）
>    - 游戏服 config.yml 键名为 **snake_case**（verify_token）；结构错误会整体回退默认值，
>      v2.5.0 启动自检打印精确行号 + 配置摘要
>    - 控制台路径为 `/control/console/command`；2.6 已移除 2.5 旧路径别名
>    - v2.5.4 增加 `subscribe_events` / `unsubscribe_events`。订阅成功后游戏服推送
>      `event{event,utc,data}`；当前事件包括 player_joined、player_left、player_died、
>      elevator_used、door_opened、round_started、round_ended。平台以 25 秒 ping 保活，
>      只向显式订阅该服务器的浏览器转发，不为事件流提供 HTTP 回退。

---

## 8. 边界情况与风险清单

| 场景 | 处理 |
|---|---|
| 浏览器断网/休眠 | hub 指数退避重连；重连后自动重订阅，平台缓存帧立即补齐 |
| 同一用户多标签页 | 各自独立 WS（简单、可观察）；平台侧轮询天然去重 |
| 订阅服务器被删除 | 前端删除后重发 subscribe；平台侧对不存在 id 静默忽略；轮询器随订阅清零回收 |
| 服务器长时间离线 | 每轮询周期广播一次 `error`（有节流）；恢复后自动回到 `state` 流 |
| 高负载（100 标签页 × 10 服务器） | 平台仅 10 个轮询器；广播为内存级扇出；连接上限 2000 |
| WS 消息超限/畸形 | 平台丢弃并断开该连接；不影响他人 |
| 控制调用竞态 | reqId 关联；超时 25s 清理 pending；连接断开时其 pending 全部丢弃 |
| 时间语义 | `fetchedAt` 以平台时钟为准；前端展示"x 秒前"用它计算 |

---

## 9. 验收标准

1. 打开 3 个标签页 + 绑定 3 台服务器：游戏服侧 8081 的请求频率 = 每台 1 次/间隔
   （而非 9 次/间隔），用 SLDataAPI 日志或抓包验证。
2. 订阅后 2 秒内收到全部服务器的首帧状态；之后按各自 refetchInterval 持续推送。
3. 通过 WS 执行 kick/ban/命令/CASSIE 等 ≥ 5 类控制操作，结果与旧 HTTP 路径一致。
4. 断开网络 30s 后恢复：自动重连、自动重订阅、30s 内恢复状态流，无人工刷新。
5. 用浏览器禁用 WS（或改 hub 配置）后：页面回退 HTTP 轮询，全部功能可用。
6. 未登录访问 `/api/sl/ws`：收到 `auth_error` 且连接被关闭，无状态泄露。
7. 订阅非本人服务器 id：被静默忽略，不返回任何数据。
