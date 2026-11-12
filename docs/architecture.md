# 架构说明

## 组件

### 前端

`src/` 是 React 19 + TypeScript 单页应用，Vite 负责开发服务器和生产构建。前端只访问同源 `/api/*` 与 `/api/sl/*`，不会直接向游戏服务器发送带控制凭据的浏览器请求。

### 平台后端

`server/server.js` 使用 Node.js 内置 HTTP/HTTPS 模块提供：

- `dist/` 静态文件与 SPA 回退
- 注册、登录、2FA 和服务端会话
- 用户服务器配置 CRUD
- 管理员用户、公告、SMTP 和 Steam 配置 API
- SLDataAPI 查询/控制代理
- WebSocket 状态与语音代理

后端默认监听 `PORT=3000`。推荐由 Nginx / Caddy 等反向代理终止 TLS，Node 保持 HTTP 内网端口；也可以配置证书让 Node 直接提供 HTTPS。

### 数据层

平台没有外部数据库。`server/store.js` 使用 JSON 文件和“临时文件 + rename”原子写入。默认数据目录为 `server/data/`（首次启动自动创建），也可通过 `PFC_DATA_DIR` 指定其他目录；CI 依靠这一能力使用隔离测试数据。

### 推荐部署拓扑

```text
浏览器 → 反向代理（Nginx / Caddy，HTTPS）→ 127.0.0.1:3000 → Node
```

反向代理负责：

- 80/443 监听与 TLS 证书
- WebSocket Upgrade（`/api/sl/ws`、`/api/sl/voice`）
- `X-Forwarded-*` 请求头
- 16 MiB 请求体上限
- 长连接超时

经反向代理访问时，请设置 `PFC_PUBLIC_URL` 为浏览器实际访问的地址（如 `https://console.example.com`），用于同源校验。

## 鉴权和权限

浏览器使用 Bearer Token 或同源会话 Cookie。Token 在 `sessions.json` 中映射到用户 ID，每次请求重新读取 `users.json`，因此角色修改可立即影响已有会话。

角色从高到低：

- `admin`：全部功能和平台配置
- `user`：服务器控制功能，不可管理平台用户/全局配置
- `guest`：只读；服务端强制清除控制 Token

所有管理员接口最终都由后端 `requireAdmin` 校验，前端隐藏按钮不是安全边界。

## 数据加密

`server/data/master.key` 或 `PFC_MASTER_KEY` 用于 AES-256-GCM 加密控制 Token、SMTP 凭据、Steam Key 和 TOTP Secret。密码采用带随机盐的 scrypt 哈希，不可解密。

主密钥与加密数据必须成套备份；只恢复 JSON 而缺失原主密钥会导致加密字段无法读取。

## 运行与守护

平台是单进程 Node 服务，使用 systemd（参考 `scripts/pfc.service`）、Windows 任务计划（`scripts/install.ps1`）或任意进程管理器守护即可。JSON 存储只支持一个写入实例，不要对同一数据目录启动多个进程。
