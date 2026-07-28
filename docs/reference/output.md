# 输出格式

## `table`（默认）

彩色表格，表头青色加粗；对中文 / 全角字符按 2 列宽度对齐，避免列错位。

## `-o json`

向 **stdout** 输出：

```json
{ "success": true, "data": ... }
```

可直接 `jq` 处理。出错时输出（同样在 stdout，方便管道统一处理）：

```json
{ "success": false, "error": { ... } }
```

```shell
supsub -o json sub list | jq '.data[] | select(.unreadCount > 0)'
```

## stdout / stderr 分工

成功提示（`✅ 登录成功`、`已登出` 等）走 **stderr**，因此两种模式下 **stdout 都只承载数据**。

「本地 skills 落后」这类启动提示同样走 stderr，不会污染 JSON 管道。

## Loading 动画

发请求 / 轮询等耗时操作期间会在 stderr 显示一个 spinner（如「加载订阅列表…」「搜索公众号「X」中…」「等待浏览器授权中…」），避免黑屏。

- 仅在**交互式终端（TTY）**下渲染。
- 管道 / 重定向 / CI / 非 TTY 环境自动静默，绝不污染 stdout。
- 可用 `SUPSUB_NO_SPINNER=1` 强制关闭。
