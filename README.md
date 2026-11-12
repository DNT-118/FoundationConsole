# Foundation Console（FDC）

面向 **SCP: Secret Laboratory** 服主的 Web 管理面板，开源（Apache-2.0）。对接 [SLDataAPI](https://github.com/DNTOF/SLDataAPI)，可以在本机运行，也可以构建成静态文件部署到你自己的服务器，查看人数、回合、玩家列表等。

> 凭据说明：服务器地址和 Token 只保存在你自己的浏览器（`localStorage`）里，请求由浏览器直接发往你填写的 SLDataAPI 服务器，不经过作者或任何第三方。移动端请看 [SLConsole](https://github.com/DNTOF/SLConsole)。

在线演示：<https://dnt-118.github.io/FoundationConsole/>（演示版，来自 `pages-demo` 分支，功能有限制；完整使用请按下文自行部署）。

## 功能概览

| 模块 | 状态 |
|------|------|
| 多服务器配置 / 切换 | 可用（localStorage） |
| Dashboard（人数 / 回合 / 延迟） | 可用 |
| Players | 可用 |
| Servers 管理 | 可用 |
| Console / RemoteAdmin / Plugins / Files / Logs / BanList / API / Settings / About | 占位页（后续迭代） |

数据源默认走 SLDataAPI 的 `GET /get_sl_data`（`verify_token` 查询参数）。

## 环境要求

- Node.js **18+**
- 一台已安装并启用 HTTP 数据接口的 SLDataAPI 服务器

## 本地运行

```bash
# Windows
./install.ps1
# 或 macOS / Linux / Git Bash / WSL
./install.sh

# 编辑 .env（已从 .env.example 复制）
# VITE_SL_DATA_API_BASE=http://127.0.0.1:8081
# VITE_SL_DATA_API_TOKEN=你的_verify_token

npm run dev
# 浏览器打开提示的本地地址，也可在 UI 里「Add Server」按服配置
```

## 自行部署

```bash
npm run build      # 产物在 dist/
npm run preview    # 本地预览构建结果
```

`dist/` 是纯静态文件，可放到 Nginx、Caddy 等任意静态站点。前端使用 History 路由，部署时请把未知路径回退到 `index.html`（例如 Nginx `try_files $uri /index.html;`）。

如果面板通过 https 访问，浏览器会拦截对 `http://` 服务器的请求（混合内容），请给 SLDataAPI 配好 https；跨域访问时 SLDataAPI 需要放行面板所在的域名（CORS）。

## 与 SLDataAPI 的字段对齐（get_sl_data）

已对齐 `Data/Models.cs` 当前快照，包括：

| 字段 | FDC 用途 |
|------|----------|
| `steam_id` / `x,y,z` | Players 卡片显示 |
| `game_version` / `active_holiday` / `voice_port` | Dashboard |
| `dntof_plugins`（SLPlayer / OmegaWarhead） | Dashboard API Health |
| `adapted_plugins` | 适配插件数量 |
| 队伍中文 `D级` / `混沌` / `基金会` / `SCP` / `观察者` | Team 映射（含独立 Chaos） |

数据面仍使用 `GET /get_sl_data?token=`（verify_token）；控制面 Bearer Key 尚未接入 UI。

## 配置说明

| 变量 | 含义 |
|------|------|
| `VITE_SL_DATA_API_BASE` | 默认 SLDataAPI 根地址（无尾斜杠） |
| `VITE_SL_DATA_API_TOKEN` | 默认 `verify_token`（仅开发/单服场景；多服请用 UI） |
| `VITE_DATA_SOURCE` | 数据源 id，默认 `sldata` |

注意：`VITE_` 开头的变量会在构建时写进前端产物，公开部署时不要在 `.env` 里填真实 Token，改在 UI 里添加服务器。

UI 里添加的服务器会保存在浏览器 `localStorage` 键 `pfc.servers`（含 Token）。清站点数据即清除。

## 许可证

[Apache License 2.0](./LICENSE)。版权与致谢见 [NOTICE](./NOTICE)。

作者：DNT_OF（[DNTOF](https://github.com/DNTOF)）
