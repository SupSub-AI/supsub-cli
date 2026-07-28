# `auth` 认证

| 命令 | 功能 |
|---|---|
| `supsub auth login` | 登录。走浏览器 OAuth 设备授权（Device Flow），自动打开浏览器并等待授权完成；成功后拉取并展示当前用户「昵称 + 邮箱」。这是唯一登录入口，无 API Key 旁路 |
| `supsub auth status` | 查看当前登录状态：邮箱、昵称、client_id、脱敏密钥、凭证来源、套餐是否过期 |
| `supsub auth logout` | 登出，清除本地保存的凭证 |

## 说明

- `auth login` 在无头 / CI 环境可设 `SUPSUB_NO_BROWSER=1` 禁止自动打开浏览器。
- 登录成功后形如 `👤 爱丽丝 <alice@example.com>` 的用户信息走 **stderr** 输出；`-o json` 模式下 `email` / `name` 一并出现在 stdout 的 `data` 中。
- 凭证保存在 `~/.supsub/config.json`（目录 `0700` / 文件 `0600`）。
- 任意请求返回 401 会自动清除本地凭证，需重新 `auth login`。
- 未登录时，所有需要认证的命令统一以 `UNAUTHORIZED` / 退出码 `2` 结束。

完整的登录方式与令牌续期说明见[登录与凭证](/guide/auth)。
