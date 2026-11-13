# 更新日志

本项目的版本变更记录。每个版本的完整说明位于 [docs/release-notes/](docs/release-notes/)，发布时会原样作为 GitHub Release 正文。

## v0.2.0 — 2026-11-13

开源后的第一个正式发布版本。完整说明：[docs/release-notes/v0.2.0.md](docs/release-notes/v0.2.0.md)。

- 定位：服主团队自部署的私有内部管理平台，不再作为公共托管平台运营
- 架构：React 前端 + Node.js 后端，凭据由后端 AES-256-GCM 加密保存并注入，浏览器不再持有游戏服令牌
- SLDataAPI 2.6.x 同步：`game_version` / `active_holiday`、重生波次、假人、物品栏、SCP-330 糖果、设施状态、适配插件动作（内测）、12 种真实 WS 事件、409 / 501 / 426 结构化错误、混沌分裂者独立成队
- 团队协作：服务器成员四级权限（owner / manager / operator / viewer）、通知规则与通知中心、定时任务、玩家历史（默认 30 天）、多服务器总览
- 玩家档案面板、文件分块读写（SHA-256 校验）、控制 WS 能力信息展示
- 注册模式 open / invite / closed 与一次性邀请码（仅限 QQ 邮箱）
- Microsoft Entra ID 设备代码流（SMTP XOAUTH2），个人 / 组织账户自动选择 SMTP 主机
- 背景设置（移除 aurora.mp4）、Steam 头像 `@steam` 修复、外链字体移除、three.js 拆包
- 安全审计：修复依赖漏洞（含 DOMPurify critical）、邮件主题注入、Steam 重定向白名单、安装脚本 Node 22 + `npm ci`；低危事项列为已知限制
- CI/CD：Node 22 / 24 矩阵，`[release]` 标记触发 Ed25519 签名发布
- 不兼容：需要 Node.js 22.14+；旧版 Microsoft OAuth 配置需重新连接；背景视频选项移除；D 级人数不再包含混沌

## v0.1.0

纯浏览器版控制台（未发布 GitHub Release），已由 v0.2.0 完整平台取代。
