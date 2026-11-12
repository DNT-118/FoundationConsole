# 数据与备份

## 数据位置

默认数据目录为 `server/data/`（相对后端目录），首次启动时自动创建；可用 `PFC_DATA_DIR` 指定其他位置。该目录只属于你自己的服务器，已在 `.gitignore` 中排除，**不要提交到任何仓库**。

| 文件 | 内容 |
| --- | --- |
| `users.json` | 用户、邮箱、角色、scrypt 密码哈希、加密 TOTP Secret |
| `sessions.json` | 会话 Token、用户 ID、过期时间 |
| `servers.json` | 用户服务器配置和加密控制 Token |
| `codes.json` | 邮箱验证码和限流时间 |
| `config.json` | 管理员引导、SMTP、Steam 等全局配置 |
| `announcement.json` | 登录公告配置 |
| `announcements.json` | 公告列表 |
| `about.json` | 鸣谢与赞助信息 |
| `master.key` | AES 加密主密钥 |

## 存储行为

后端每次读取 JSON 文件获取最新状态。保存时先写同目录临时文件，再使用 rename 原子替换。角色更新不要求重启 Node，已有会话在下一次请求时读取新角色。

## 备份

主密钥与加密数据必须成套备份：只恢复 JSON 而缺少原来的 `master.key`（或 `PFC_MASTER_KEY`）会导致 API Key、SMTP 凭据、Steam Key 和 TOTP Secret 无法解密。

推荐做法：

1. 停止平台进程，或确认没有写入
2. 打包整个数据目录，例如 `tar czf fdc-data-$(date +%F).tar.gz -C server data`
3. 备份文件按机密数据保管（加密存储，不放公开位置）

## 恢复

1. 停止平台进程
2. 把备份解压回数据目录（或 `PFC_DATA_DIR` 指向的位置）
3. 检查权限：`chmod 700 server/data && chmod 600 server/data/master.key`
4. 启动平台并访问 `/api/health` 确认正常

数据损坏时先停止写入并恢复配套备份，不要删除 `users.json`、`config.json` 或 `master.key` 来"重新初始化"——首个管理员引导只会发生一次。
