# Foundation Console（FDC）· GitHub Pages 演示分支

> 这是 **`pages-demo` 演示分支**，只用于构建 GitHub Pages 在线演示，不是正式发布源码。
> 正式开源版本（含 Node 后端）、部署说明和完整代码请看 [`main` 分支](https://github.com/DNT-118/FoundationConsole/tree/main)。

在线演示（仓库公开并启用 Pages 后）：<https://dnt-118.github.io/FoundationConsole/>

FDC 是面向 **SCP: Secret Laboratory** 服主的 Web 管理面板，对接 [SLDataAPI](https://github.com/DNTOF/SLDataAPI)。
本分支基于 **v0.2.0** 前端（已与 SLDataAPI main 对齐：2.6.x 路由与错误提示、混沌分裂者单独成队、Steam `@steam` 头像修复、设置里的背景选项等），
把 Node 后端换成了一个**运行在浏览器里的模拟后端**（`src/demo/mockBackend.ts`，拦截同源 `/api/*` 请求），构建产物是可以直接放在 GitHub Pages 上的纯静态页面。

## 演示版限制

- **免登录**：打开即以本地「演示管理员」身份进入；登录 / 注册页会直接跳回仪表盘，「登出」不生效。
- **数据只存在当前浏览器**：服务器列表、公告、封禁、文件等都保存在 `localStorage`（键 `fdc-demo.state`；背景、主题、语言等偏好也在本地）。清除站点数据即重置，换浏览器或设备不会同步。
- **游戏服务器是模拟的**：内置「演示服务器（模拟）」（`demo.local:8081`）的玩家、回合、核弹、插件、日志等数据都在浏览器本地生成；玩家里包含 D 级、**混沌分裂者（单独一队）**、基金会、SCP、观众。控制操作（踢出、封禁、命令、广播等）只是模拟执行并记入本地审计列表，不会发到任何真实服务器。
- **无法连接真实 SLDataAPI**：GitHub Pages 没有后端代理，新添加的非演示服务器只会显示「演示版无法连接真实游戏服务器」。
- **以下功能不可用（页面上已标注「演示版不可用」并禁用）**：
  - SMTP 邮箱配置、测试邮件、邮箱验证码、Microsoft（Entra ID）OAuth 授权
  - Steam API Key 与真实 Steam 头像 / 昵称（头像显示为昵称缩写）
  - 双因素验证（TOTP）、用户 / 账户管理
  - 语音监听、实时事件流（需要平台 WebSocket 中继）
- 不含任何视频文件；「二次元」主题背景使用内置渐变或你自己设置的图片。
- 页面顶部有常驻、不可关闭、持续红色闪烁的提示栏。

完整功能（登录与会话、加密存储、后端代理、控制、邮件、语音、事件流等）请按 `main` 分支的 README 自行部署。

## 本分支相对 v0.2.0 的改动

| 内容 | 位置 |
|------|------|
| 演示模式开关、提示栏、浏览器内模拟后端、不可用功能提示 | `src/demo/` |
| 安装模拟后端、提示栏布局、Router 子路径 | `src/main.tsx`、`src/layouts/AppShell.tsx` |
| 免登录（跳过登录 / 注册页，演示会话不过期） | `src/App.tsx`、`src/store/authStore.ts` |
| 演示版不建立平台 WebSocket，改走（模拟的）HTTP 通道 | `src/ws/hub.ts` |
| 设置页禁用 SMTP / Microsoft OAuth、Steam、2FA、账户管理 | `src/pages/Settings.tsx` |
| 子路径 `/FoundationConsole/`、`404.html` 路由回退、`.nojekyll` | `vite.config.ts`（`--mode demo`） |
| 自动部署到 GitHub Pages（仅 `pages-demo` 分支推送触发） | `.github/workflows/pages.yml` |
| 移除 Node 后端、安装 / 打包脚本、发布签名流程与后端文档 | 见 `main` 分支 |

## 本地构建演示版

需要 Node.js ≥ 22.14。

```bash
npm ci
npm run typecheck
npm test               # 前端单元测试
npm run build:demo     # 默认子路径 /FoundationConsole/，可用 FDC_BASE 覆盖
npm run dev:demo       # 本地以演示模式开发
```

## 许可证

[Apache License 2.0](./LICENSE)。版权与致谢见 [NOTICE](./NOTICE)。

作者：DNT_OF（[DNTOF](https://github.com/DNTOF)）

致谢：[FXDYJ](https://github.com/FXDYJ) —— 部分版本的维护者，地图脚本（地图布局/几何数据，参见 [scpslmaps.fxdyj.com](https://scpslmaps.fxdyj.com)）的提供者
