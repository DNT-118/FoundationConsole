# 本地开发

## 环境要求

- Node.js 22.14 以上；生产推荐 24，CI 验证 22 / 24
- npm 10 以上
- Windows、Linux 或 macOS

## 安装

```bash
npm ci
npm ci --prefix server
```

根依赖用于前端、构建和测试；`server/` 的独立锁文件用于生产最小化安装。

## 开发运行

终端一：

```bash
PORT=3000 npm start
```

终端二：

```bash
npm run dev
```

Vite 会将平台 API 转发到 `127.0.0.1:3000`。默认开发地址由 Vite 输出，通常为 `http://127.0.0.1:5173`。

PowerShell 设置端口：

```powershell
$env:PORT = '3000'
npm start
```

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | Node 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；本机开发或同机反代可设为 `127.0.0.1` |
| `PFC_DATA_DIR` | `server/data` | 运行时数据目录；测试隔离使用 |
| `PFC_MASTER_KEY` | `server/data/master.key` | 覆盖文件主密钥 |
| `PFC_STEAM_KEY` | 空 | 兼容旧部署的 Steam Key 注入方式 |
| `PFC_PUBLIC_URL` | 空 | 浏览器访问的公网地址，经反向代理时用于同源校验 |
| `HTTP_REDIRECT_PORT` | 空 | Node 直连 HTTPS 时，额外监听该端口并跳转到 HTTPS |
| `SSL_CERT_PATH` | 自动探测 | Node 直连 TLS 证书；使用反向代理时不需要 |
| `SSL_KEY_PATH` | 自动探测 | Node 直连 TLS 私钥；使用反向代理时不需要 |

参考 [.env.example](../.env.example)，不要提交真实 `.env`。

## 质量检查

```bash
npm run typecheck
npm test
npm run build
```

`npm test` 包括：

- Node 后端语法检查
- TOTP、存储防损坏、HTTP/WS 契约、SSRF 与静态资源测试
- 前端请求取消、不重复发送、超时队列清理测试
- 登录、注册、2FA、权限隔离和加密落盘端到端测试

端到端测试在系统临时目录创建 `pfc-e2e-*` 数据目录，完成后删除，不会修改仓库的 `server/data/`。

无真实游戏服的页面验收：先构建，再执行 `node scripts/preview-fixture.cjs`。详见 [PEAK 维护说明](peak-maintenance.md)。

## 构建产物

`npm run build` 输出 `dist/`。`dist/`、`node_modules/` 和旧发布包都由 `.gitignore` 排除，CI 每次重新构建。
