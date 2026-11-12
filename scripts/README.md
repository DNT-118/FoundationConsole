# 脚本目录

| 脚本 | 用途 |
| --- | --- |
| `install.sh` | Debian/Ubuntu 一键安装（在发布包根目录执行）：安装依赖、生成主密钥、注册 systemd 服务 |
| `install.ps1` | Windows 一键安装：安装依赖、生成主密钥、注册任务计划、放行防火墙 |
| `pfc.service` | systemd 服务模板，按实际目录修改 `WorkingDirectory` / `ExecStart` 并替换 `PFC_MASTER_KEY` |
| `check-syntax.cjs` | `npm test` 的语法检查步骤 |
| `preview-fixture.cjs` | 本机 UI 验收：启动临时数据目录 + 模拟游戏服，不读写 `server/data`、不连接真实游戏服 |
| `verify-public-health.mjs` | 部署后检查 `<地址>/api/health`，用法 `node scripts/verify-public-health.mjs https://console.example.com` |

发布包由仓库根目录的 `build-package.sh` 生成，安装脚本会被放到发布包根目录。
