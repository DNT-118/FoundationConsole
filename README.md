# Foundation Console（FDC）· GitHub Pages 演示分支

> 这是 **`pages-demo` 演示分支**，只用于构建 GitHub Pages 在线演示，不是正式源码。
> 正式开源版本、部署说明和完整代码请看 [`main` 分支](https://github.com/DNT-118/FoundationConsole/tree/main)。

在线演示：<https://dnt-118.github.io/FoundationConsole/>

FDC 是面向 **SCP: Secret Laboratory** 服主的 Web 管理面板，对接 [SLDataAPI](https://github.com/DNTOF/SLDataAPI)。本分支基于早期 v0.1.0 纯前端版本（`main` 现为带 Node 后端的完整平台），加了一个构建期「演示模式」，产物是可以直接放在 GitHub Pages 上的纯静态页面。

## 演示版限制

- 免登录，所有数据（服务器列表、Token、设置）只存在当前浏览器的 `localStorage`（键 `fdc-demo.servers`），清站点数据即清除，换浏览器或设备不会同步。
- 首次打开会自动添加一台「演示服务器（模拟）」（地址 `demo://sample`），数据在浏览器本地生成，不连接任何真实服务器。
- 页面是 https，浏览器会拦截对 `http://` 远程服务器的请求（混合内容）；要连接真实 SLDataAPI，需要 https 地址并放行 `dnt-118.github.io` 的跨域请求（CORS），否则页面会显示中文原因。
- Console / RemoteAdmin / Plugins / Files / Logs / BanList / API / Settings / About 仍是占位页，玩家卡片上的操作按钮不可用。
- 页面顶部有常驻的红色闪烁提示栏，不可关闭。

完整功能（登录、后端代理、控制、语音等）请按 `main` 分支的 README 自行部署。

## 本分支的改动

| 内容 | 位置 |
|------|------|
| 演示模式开关、提示栏、模拟数据、混合内容 / CORS 提示 | `src/demo/` |
| 子路径 `/FoundationConsole/`、`404.html` 路由回退、`.nojekyll` | `vite.config.ts`（`--mode demo`） |
| 自动部署到 GitHub Pages（仅 `pages-demo` 分支推送触发） | `.github/workflows/pages.yml` |

不带 `--mode demo` 时，构建结果与早期 v0.1.0 前端行为一致。

## 本地构建演示版

```bash
npm ci
npm run build:demo     # 默认子路径 /FoundationConsole/，可用 FDC_BASE 覆盖
npm run dev:demo       # 本地以演示模式开发
```

## 许可证

[Apache License 2.0](./LICENSE)。版权与致谢见 [NOTICE](./NOTICE)。

作者：DNT_OF（[DNTOF](https://github.com/DNTOF)）
