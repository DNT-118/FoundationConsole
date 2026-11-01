# 安全说明

- API Token / verify_token 仅保存在使用者浏览器的 localStorage（键名 `pfc.servers`）或本机 `.env`（已被 `.gitignore` 忽略，请勿提交）。
- 请求直接发往使用者配置的 SLDataAPI 地址；本仓库不含后端、不含中转、不收集遥测。
- 开源发布前请确认工作副本中无真实 Token、无服务器 IP 清单、无 `.env`。
- 发现漏洞可在 GitHub Issues 私下联系维护者，或通过作者公开渠道报告。

# Security

- Tokens live only in the user's browser localStorage (`pfc.servers`) or a local `.env` (gitignored).
- Requests go straight to the user-configured SLDataAPI URL. No backend, no proxy, no telemetry in this repo.
- Before publishing, ensure the tree has no real tokens, no private server lists, and no `.env`.
