# 安全说明

- 游戏服 VerifyToken / API Key、SMTP 凭据、Steam Key、TOTP Secret 以 AES-256-GCM 加密保存在部署者自己服务器的数据目录（默认 `server/data/`），主密钥为 `master.key` 或 `PFC_MASTER_KEY`。
- 凭据只由后端发往部署者配置的 SLDataAPI 服务器及其配置的 Steam / SMTP 服务；浏览器不持有游戏服凭据，平台不含遥测。
- 数据目录、`.env`、证书私钥已被 `.gitignore` 排除，请勿提交。
- 发布包附带 Ed25519 签名，验签方法见 README「发布与验签」。
- 发现漏洞请通过 GitHub 私下报告（Security → Report a vulnerability）或作者公开渠道联系维护者，请勿公开披露未修复的问题。

# Security

- Game-server tokens/API keys, SMTP credentials, Steam keys and TOTP secrets are stored AES-256-GCM encrypted in the deployer's own data directory (`server/data/` by default).
- Credentials are only sent by the backend to the SLDataAPI server and the Steam/SMTP services the deployer configures. No telemetry.
- The data directory, `.env` and private keys are gitignored. Never commit them.
- Report vulnerabilities privately via GitHub security advisories.
