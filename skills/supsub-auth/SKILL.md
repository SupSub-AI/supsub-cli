---
name: supsub-auth
version: 0.1.0
description: SupSub CLI 认证管理 —— 登录 / 登出 / 查看登录状态。登录走 OAuth 浏览器设备授权，CLI 不支持 API Key 登录。匹配「supsub 登录」「supsub 登出」「查看我在 supsub 的登录状态」「我现在 supsub 用的是哪个账号」「supsub auth login / logout / status」。在调用其他 supsub 子命令前，如不确定凭证状态可先用本 skill 跑 `supsub auth status`。
---

# supsub-auth Skill

Log in, log out, and check authentication status for the SupSub CLI.

## Prerequisites

- 安装：`pnpm add -g @supsub/cli`（或 `npm i -g @supsub/cli`）
- 登录凭证保存在 `~/.supsub/config.json`（目录权限 0700，文件权限 0600）。`supsub auth login` 走 OAuth 设备授权，成功后写入 `access_token` / `refresh_token`。**CLI 不支持 API Key 登录**，没有 `--api-key` flag / `SUPSUB_API_KEY` 这一类入口。

## Commands

### Log in

```
supsub auth login
```

`supsub auth login` 会自动打开浏览器，走 OAuth 设备授权流程（Device Authorization）完成登录；授权成功后把 `access_token` / `refresh_token` 写入 `~/.supsub/config.json`。这是 CLI 唯一的登录方式（不支持 API Key 登录）。

```bash
# 自动打开浏览器完成授权
supsub auth login

# 无头 / e2e 环境：跳过自动打开浏览器，手动复制终端里的链接去授权
SUPSUB_NO_BROWSER=1 supsub auth login
```

> JSON 模式 (`-o json`) 下，登录成功 stdout 输出 `{"success":true,"data":{"client_id":"supsub-cli","email":"...","name":"..."}}`（`email` / `name` 来自登录后拉取的用户信息；若拉取失败这两个字段缺省，退化为 `{"client_id":"supsub-cli"}`）；提示信息走 stderr。

---

### Check status

```
supsub auth status
```

Shows the current logged-in user, the masked credential, and its source。正常 OAuth 登录后 `api_key_source` 为 `config`（凭证来自配置文件里的 `access_token`）；`api_key` 字段是脱敏后的访问令牌（CLI 沿用 `sk_live_***` 前缀展示，并非真有 API Key）。

```bash
supsub auth status
supsub auth status -o json
```

JSON shape:

```json
{
  "success": true,
  "data": {
    "email": "...",
    "name": "...",
    "client_id": "supsub-cli",
    "api_key_source": "config",
    "api_key": "sk_live_***xxxx"
  }
}
```

If unauthenticated, exits with code `2` (`UNAUTHORIZED`) and a message asking the user to run `supsub auth login`.

---

### Log out

```
supsub auth logout
```

Removes saved credentials from `~/.supsub/config.json`.

```bash
supsub auth logout
supsub auth logout -o json
```

JSON 模式下输出 `{"success":true,"data":{}}`。

---

## Agent Usage Notes

- 在调用其他 supsub 子命令之前先跑 `supsub auth status`，确认凭证有效；未登录时引导用户 `supsub auth login`。
- CLI **不支持 API Key 登录**，也没有 `--api-key` flag / `SUPSUB_API_KEY` 环境变量；登录唯一入口是 `supsub auth login`（OAuth 设备授权）。
- 请求所用 Bearer 凭证由 `resolveApiKey()` 解析，优先级（高 → 低）：配置文件 `access_token`（OAuth 设备授权令牌）> 配置文件 `bearer_token`（高级用法：手动从浏览器粘贴的临时会话 token）。
- 401 响应会自动清除本地存储的全部凭证（`access_token` / `refresh_token` / `bearer_token`，见 `src/http/client.ts` 调用的 `clearAuth()`）；遇到 exit code `2` 时通常需要重新登录。
- 解析 JSON 时使用 `-o json`；常见 exit code：`0` OK，`2` UNAUTHORIZED，`3` PLAN_EXPIRED，`10` NETWORK，`11` SERVER，`64` INVALID_ARGS。
- 自定义 API base URL：设置 `SUPSUB_API_URL`（默认 `https://supsub.net`），用于本地或测试环境。
