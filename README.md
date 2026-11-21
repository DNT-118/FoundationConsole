# Foundation Console（FDC）

**SCP: Secret Laboratory 服主团队自部署的私有内部管理平台**（开源，Apache-2.0）。由 React 前端和 Node.js 后端组成，部署在团队自己的服务器上，通过 [SLDataAPI](https://github.com/DNTOF/SLDataAPI) 读取和控制游戏服务器。面向服主与团队成员使用，不是公共托管服务：账户、服务器配置、分享与权限都只属于你自己的部署实例。

在线演示：<https://dnt-118.github.io/FoundationConsole/>

## 功能概览

- 团队账户：首个账户为管理员，`admin` / `user` / `guest` 三级权限，可选 TOTP 双因素验证
- 注册模式（默认开放 QQ 邮箱自助注册）：管理员可关闭自助注册或切换为邀请制（一次性邀请码），QQ 邮箱限制不变
- 服务器可分享给团队成员并按角色授权（只看数据 / 值班 / 管理），服务端强制校验
- 按用户隔离的服务器配置，支持多台游戏服务器
- Dashboard、玩家、插件、地图、日志、举报、事件、封禁列表、文件、控制台、RemoteAdmin
- 全服广播、CASSIE、管理聊天、语音监听（经后端代理 SLDataAPI 语音口）
- WebSocket 实时状态与控制通道，自动回退 HTTP
- 公告、关于页鸣谢、SMTP 邮件验证码（QQ 邮箱 / Outlook OAuth2）、Steam 头像与昵称
- 中英文界面、主题切换

## 凭据与安全

- 游戏服 VerifyToken / API Key、SMTP 凭据、Steam Key、TOTP Secret 以 **AES-256-GCM** 加密保存在你自己服务器的数据目录（默认 `server/data/`），主密钥为 `server/data/master.key` 或环境变量 `PFC_MASTER_KEY`。
- 这些凭据只由后端发往你配置的 SLDataAPI 服务器（Steam Key 发往 Steam Web API，SMTP 凭据发往你配置的邮件服务器）；浏览器只访问同源 `/api`，不持有游戏服凭据。作者和任何第三方都接触不到这些数据，平台也不含遥测。
- 密码使用 scrypt 加盐哈希，会话保存在服务端，7 天过期；非管理员不能把服务器指向私网地址。

详见 [安全说明](docs/security.md) 与 [数据与备份](docs/data-and-backup.md)。

## 架构

```text
浏览器
  │ HTTPS / WebSocket（同源）
  ▼
反向代理（Nginx / Caddy，可选）
  │
  ▼
Foundation Console 后端 :3000（server/server.js）
  ├─ dist/              React 单页应用
  ├─ /api/auth/*        注册、登录、2FA、会话
  ├─ /api/admin/*       用户、公告、SMTP、Steam 配置
  ├─ /api/servers       每个用户的服务器配置
  └─ /api/sl/*          SLDataAPI 数据 / 控制 / WebSocket / 语音代理
        │ Authorization: Bearer <VerifyToken 或 API Key>
        ▼
你的 SCP:SL 服务器 + SLDataAPI
```

详见 [架构说明](docs/architecture.md)。

## 环境要求

- Node.js **22.14+**（推荐 24）
- 已安装 SLDataAPI（建议 2.6.0 PEAK 及以上）的 SCP:SL 服务器

## 本地运行

```bash
npm ci
npm ci --prefix server
npm run build          # 构建前端到 dist/
PORT=3000 npm start    # 启动后端，同时托管 dist/
```

浏览器打开 <http://127.0.0.1:3000>。开发前端时可另开终端运行 `npm run dev`（Vite 开发服务器）。

## 自行部署

1. 构建发布包，或在 Releases 下载已签名的发布包：

   ```bash
   ./build-package.sh     # 产物：release/fdc-v<版本>.tar.gz（前端 dist + 混淆后端）
   ```

2. 解压到服务器，在包根目录执行安装脚本：
   - Linux：`sudo bash install.sh`（安装依赖、生成主密钥、注册 systemd 服务）
   - Windows：`powershell -ExecutionPolicy Bypass -File install.ps1`

   也可以手动运行：`npm ci --omit=dev --prefix server && node server/server.js`，用 `pfc.service` 模板交给 systemd 守护。

3. 推荐用 Nginx / Caddy 反代并配置 HTTPS，转发 WebSocket（`/api/sl/ws`、`/api/sl/voice`），并设置 `PFC_PUBLIC_URL`。

### 配置

在环境变量或 `.env`（参考 [.env.example](.env.example)）中设置：

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | 监听端口与地址；同机反代可设 `HOST=127.0.0.1` |
| `PFC_PUBLIC_URL` | 空 | 浏览器访问的地址，如 `https://console.example.com`，经反代时用于同源校验 |
| `PFC_DATA_DIR` | `server/data` | 运行数据目录，首次启动自动创建 |
| `PFC_MASTER_KEY` | 自动生成 `master.key` | 加密主密钥；设置后不再使用文件 |
| `PFC_STEAM_KEY` | 空 | Steam Web API Key（也可在设置页填写） |
| `PFC_MS_CLIENT_ID` | 内置公共应用 ID | Microsoft Entra 多租户公共客户端（非机密默认值，可覆盖） |
| `PFC_MS_TENANT` | `common` | OAuth 租户：`common` / `consumers` / `organizations` / 具体租户 ID |
| `PFC_MS_CLIENT_SECRET` | 空 | 可选；仅机密客户端需要，公共客户端留空 |
| `PFC_MS_REDIRECT_URI` | 空 | 可选；授权码 + PKCE 跳转流程的完整回调地址（默认流程为设备代码流，无需配置）。回调地址只从本变量或 `PFC_PUBLIC_URL` 推导，绝不用请求 Host 头 |
| `PFC_MS_SCOPES` | `https://outlook.office.com/SMTP.Send offline_access openid email profile` | 可选覆盖 OAuth scope |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | `server/certs/*.pem` | 让 Node 直接提供 HTTPS 时使用 |

### Microsoft OAuth（Outlook / Office365 发信）

「设置 → 邮箱配置 → OAuth2」默认走**设备代码流**（管理员通常在远程公网控制台操作，无 localhost 回调）：
点「连接 Microsoft 账号」→ 打开 [microsoft.com/devicelogin](https://microsoft.com/devicelogin) 输入页面上显示的用户码 → 授权完成后台自动保存加密的 refresh token，**无需再点保存**。
配置 `PFC_MS_REDIRECT_URI`（或 `PFC_PUBLIC_URL`）后设置页会出现「跳转授权」按钮（授权码 + PKCE，state 绑定管理员会话、10 分钟过期）。

- refresh token 以 `master.key` AES-256-GCM 加密落盘；每次刷新自动轮换写回；`invalid_grant` 时设置页提示「需要重新授权」。
- access token 仅内存缓存（带过期）；nodemailer 只使用现成 access token（SASL XOAUTH2），不会自行请求令牌端点。
- SMTP 主机按 id_token 的 `tid` 自动选择：个人账户（outlook.com）→ `smtp-mail.outlook.com:587`，组织账户 → `smtp.office365.com:587`；host 字段可手动覆盖。
- 普通 SMTP（授权码/密码）模式不受影响；测试发送始终使用**已保存**的配置与凭据。

### 首次启动与管理员

1. 首次启动后数据目录为空，`/api/auth/status` 返回 `firstRun: true`。
2. 打开面板注册第一个账户（QQ 邮箱格式，首个账户无需验证码），它会自动成为管理员；此引导只发生一次。在完成注册前不要把端口暴露到公网，或先只监听 `127.0.0.1`。
3. 管理员在「设置」中配置 SMTP（后续用户注册需要邮箱验证码）、Steam Key、公告等，并建议启用 2FA。
4. **注册模式**（设置 → 注册模式）：默认 `open`（QQ 邮箱自助注册 + 邮箱验证码）；内部部署建议改为 `invite`（管理员生成一次性邀请码）或 `closed`（完全关闭自助注册，由管理员在账号管理中建号）。三种模式都仅限 QQ 邮箱，首个管理员引导不受影响。

### 连接 SLDataAPI

1. 在游戏服 SLDataAPI 配置中设置强随机 `verify_token`（数据口）。
2. 在游戏服控制台执行 `sldataapi apikey create <id> admin`（或 `duty`）生成控制用 API Key。
3. 在面板「服务器」页添加服务器：填写游戏服主机、SLDataAPI 端口、VerifyToken、API Key（可选，用于控制、事件、语音）、控制连接方式（HTTP / WebSocket）和轮询间隔。语音端口从 `get_sl_data` 的 `voice_port` 自动获取。

后端读取数据时调用 `GET /get_sl_data`，控制操作调用 `/control/*`，适配插件走 `/plugins/*`，实时控制使用 SLDataAPI 的 WebSocket 通道。字段与接口细节见 [PEAK 升级与维护](docs/peak-maintenance.md) 和 [SLDataAPI 契约补充](docs/slapi-contract-addendum.md)。

### 账户与界面设置

- **个性化背景**（设置 → 背景）：默认 / 内置渐变 / 自定义图片 URL（仅 http/https，受 CSP `img-src` 约束）/ 本地上传（≤2MB）。偏好按用户名保存在各浏览器本地（localStorage，不上传服务器）；在「二次元」主题下显示，遮罩强度与模糊可调以保证可读性。
- **Steam Key**（设置 → Steam API Key）：玩家头像与 Steam 昵称的数据源（免费获取：steamcommunity.com/dev/apikey）。密钥 AES-256-GCM 加密存服务器；也可用环境变量 `PFC_STEAM_KEY` 配置。SLDataAPI 的 `steam_id` 带 `@steam` 后缀（如 `76561198…@steam`），平台已自动剥后缀；`@northwood` / `@discord` / 假人等非 Steam ID 不请求头像。
- **上游能力信息**（仪表盘 → API 健康度）：通过 WS 控制通道展示上游版本、本连接是否 TLS、证书 SHA-256 指纹与已开启的内测能力（`adapted_actions` / `file_chunks`）。内测能力未开启时相关 UI（适配插件动作、文件分块读写）会直接提示，而不是点了才 404。

### duty Key（值班 Key）权限说明

`duty` 模板偏只读：踢人/封禁/广播/职业/效果/控制台/插件/文件等默认**未授予**。FDC 不绕过上游 ACL——使用 duty Key 时这些操作会如实显示上游 403。如需值班执行某些操作，请在游戏服 `apikey.config` 中对该 Key 的 `endpoints_override` 显式放开（例如）：

```yaml
keys:
  - id: duty-1
    template: duty
    endpoints_override:
      /control/broadcast: true
      /control/moderation/kick: { read: false, write: true }
```

注意：`/control/adapted/`（适配插件写）与 `/control/files/` 即使 `admin` / `all_control_true` 也不自动授予，必须 `endpoints_override` 显式放开。

## 开发与测试

```bash
npm run typecheck
npm test               # 语法检查 + 后端单元测试 + 前端测试 + 端到端测试（使用临时数据目录）
npm run build
npm run obfuscate      # 生成混淆后端 server-dist/
```

更多说明见 [本地开发](docs/local-development.md)。

## CI/CD

工作流：`.github/workflows/ci.yml`

- **CI**：每次 push 和 pull request 都会安装依赖、类型检查与语法检查、构建前端、运行测试，并验证混淆后端能生成（Node 22 / 24）。
- **发布**：推送到 `main` 的提交信息包含发布标记时，在 CI 通过后自动发布：
  - `[release]`：按 `package.json` 的版本发布；
  - `[release vX.Y.Z]`：同上，但标记里的版本必须与 `package.json` 一致，否则失败。

  例如先把 `package.json` 改成 `0.3.0`，再提交 `chore: release 0.3.0 [release v0.3.0]`。工作流会构建发布包、签名、创建标签 `vX.Y.Z` 和 GitHub Release，上传发布包、签名和 SHA256 校验值。标签已存在、缺少签名 Secret 或公钥时会直接失败，不会发布未签名的包。

  每个版本必须先写好 `docs/release-notes/vX.Y.Z.md`（并在 [CHANGELOG.md](CHANGELOG.md) 补一条摘要），工作流会把它原样作为 Release 正文；缺少该文件时同样直接失败。

### 发布与验签

发布包使用 Ed25519 签名（OpenSSL 3）。仓库所有者首次配置：

```bash
# 生成密钥对（带口令保护的私钥）
openssl genpkey -algorithm ed25519 -aes-256-cbc -out fdc-release.key.pem
openssl pkey -in fdc-release.key.pem -pubout -out keys/fdc-release.pub.pem

# 私钥与口令存入仓库 Secret（需要 GitHub CLI；也可在网页 Settings → Secrets and variables → Actions 中添加）
gh secret set FDC_SIGNING_KEY < fdc-release.key.pem
gh secret set FDC_SIGNING_KEY_PASSPHRASE   # 按提示输入口令；私钥不加密时可不设置

# 只提交公钥，私钥离线妥善保管
git add keys/fdc-release.pub.pem
```

下载者验证：

```bash
sha256sum -c SHA256SUMS
openssl pkeyutl -verify -pubin -inkey keys/fdc-release.pub.pem -rawin \
  -in fdc-vX.Y.Z.tar.gz -sigfile fdc-vX.Y.Z.tar.gz.sig
# 输出 Signature Verified Successfully 即为官方发布包
```

## 许可证

[Apache License 2.0](./LICENSE)。版权与致谢见 [NOTICE](./NOTICE)。

作者：DNT_OF（[DNTOF](https://github.com/DNTOF)）

致谢：[FXDYJ](https://github.com/FXDYJ) —— 部分版本的维护者，地图脚本（地图布局/几何数据，参见 [scpslmaps.fxdyj.com](https://scpslmaps.fxdyj.com)）的提供者
