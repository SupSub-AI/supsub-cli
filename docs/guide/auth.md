# 登录与凭证

## 登录

```shell
supsub auth login
```

走 OAuth **设备授权流程（Device Flow）**：终端打印授权链接与授权码并自动打开浏览器，你在浏览器里确认后，CLI 轮询拿到令牌即登录成功。成功后会拉取并展示当前用户「昵称 + 邮箱」。这是 CLI **唯一**的登录入口——没有 API Key 一类的旁路。

无头 / CI / agent 环境里禁止自动打开浏览器：

```shell
SUPSUB_NO_BROWSER=1 supsub auth login
```

此时从终端输出里提取形如 `请在浏览器打开 https://…` 的链接，交由用户完成授权即可。

## 查看与退出

```shell
supsub auth status    # 邮箱、昵称、client_id、脱敏密钥、凭证来源、套餐是否过期
supsub auth logout    # 清除本地保存的凭证
```

`auth status` 退出码为 `0` 即表示已登录可用；未登录时退出码为 `2`。

## 凭证存储

凭证保存在 `~/.supsub/config.json`，目录权限 `0700`、文件权限 `0600`（Windows 上跳过 chmod）。可用 `SUPSUB_CONFIG_DIR` 覆盖所在目录。

## 凭证优先级

每次请求按以下顺序取凭证，靠前者胜出：

1. 配置文件中的设备流令牌（`access_token`，可自动续期）
2. 配置文件中手动粘贴的浏览器会话 token（`bearer_token`，无续期通道）

## 令牌续期与失效

- `access_token` 过期时，CLI 会自动用 `refresh_token` 续期，无需重新登录。
- 任意请求返回 **401** 会自动清除本地凭证，需要重新 `supsub auth login`。
- 套餐过期的请求以退出码 `3` 结束，与「未登录」（`2`）区分开。

::: tip 完整时序图
设备授权的端到端时序、轮询状态机与端点契约，见仓库内的设计文档 [`docs/cli-auth-flow.md`](https://github.com/SupSub-AI/supsub-cli/blob/master/docs/cli-auth-flow.md)。
:::
