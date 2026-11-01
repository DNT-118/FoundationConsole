# Foundation Console（FDC）

面向 **SCP: Secret Laboratory** 服主的浏览器端管理面板。对接 [SLDataAPI](https://github.com/DNTOF/SLDataAPI)，在本地浏览器里查看人数、回合、玩家列表等；Token 只存在你自己的浏览器里，直连你填的服务器地址。

> 安全说明：凭据不会上传到作者或任何第三方。即便开源，开发者也接触不到你填的 Key。移动端请看 [SLConsole](https://github.com/DNTOF/SLConsole)。

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

## 快速开始

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

生产构建：

```bash
npm run build
npm run preview
```

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

UI 里添加的服务器会保存在浏览器 `localStorage` 键 `pfc.servers`（含 Token）。清站点数据即清除。

## 许可证

[Apache License 2.0](./LICENSE)。版权与致谢见 [NOTICE](./NOTICE)。

作者：DNT_OF（[DNTOF](https://github.com/DNTOF)）
