# 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `SUPSUB_API_URL` | 覆盖 API 基址（等价于 `--api-url`，但 flag 优先级更高） | `https://supsub.net` |
| `SUPSUB_WEB_URL` | 覆盖 Web 基址（[`deepread share`](/reference/deepread) 生成的 `<web>/s/<code>` 用它拼链接） | 跟随 API 基址 |
| `SUPSUB_NO_BROWSER` | 真值时 `auth login` 不自动打开浏览器 | 未设 |
| `SUPSUB_NO_SPINNER` | 真值时关闭所有 loading 动画（非 TTY 下本就不渲染） | 未设 |
| `SUPSUB_NO_SKILLS_NOTIFIER` | 真值时关闭「本地 skills 落后」的启动提示 | 未设 |
| `SUPSUB_CONFIG_DIR` | 覆盖配置目录（凭证存于 `<dir>/config.json`，状态存于 `<dir>/skills-state.json`） | `~/.supsub` |

## 凭证存储与优先级

凭证保存在 `~/.supsub/config.json`（目录 `0700` / 文件 `0600`）。每次请求按以下优先级取凭证，靠前者胜出：

1. 配置文件中的设备流令牌（`access_token`，可自动续期）
2. 配置文件中手动粘贴的浏览器会话 token（`bearer_token`，无续期通道）

任意请求返回 **401** 会自动清除本地凭证，需重新 `supsub auth login`。

## 常见用法

```shell
# 指向本地 API 服务器调试
SUPSUB_API_URL=http://localhost:3000 supsub sub list

# CI / agent 环境：无浏览器、无动画、独立配置目录
export SUPSUB_NO_BROWSER=1
export SUPSUB_NO_SPINNER=1
export SUPSUB_CONFIG_DIR=/tmp/supsub-ci
```
