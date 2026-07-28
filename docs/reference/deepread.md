# `deepread` 精读

对**单篇**文章做 AI 深度拆解，产出结构化的精读结果。

::: warning 按次消耗月度额度
**没有退额度操作**，余额用 `deepread quota` 查询。已精读过的文章重复发起不会重复扣费。
:::

精读 ≠ 摘要（`sub contents` 的 `summary` 已经是摘要），也 ≠ 全文（CLI 没有取原文的接口）。

| 命令 | 功能 |
|---|---|
| `supsub deepread run` | 发起精读，默认前台等待到完成；已精读过的文章重复发起不会重复扣费 |
| `supsub deepread get` | 查看结果，默认优先本地缓存 |
| `supsub deepread list` | 本地精读队列（收件箱语义） |
| `supsub deepread quota` | 本月额度 `{limit, used, remaining}` |
| `supsub deepread share` | 生成分享链接 `<web>/s/<code>` |
| `supsub deepread show` | 查看他人分享的精读（**无需登录**） |
| `supsub deepread drop` | 从本地队列移除（服务端结果不受影响，之后 `get` 能重新拉回且不扣额度） |

定位一篇文章统一靠 `--type` + `--content-id` 这一对，`contentId` 来自 `sub contents` / `focus contents` / `search`。

## `supsub deepread run` — 发起精读

| 选项 | 说明 | 默认 |
|---|---|---|
| `--type <MP\|WEBSITE\|X>` | 信息源类型（`X` = 推特） | **必填** |
| `--content-id <id>` | 内容 ID | **必填** |
| `--title <title>` | 文章标题，写入本地队列便于事后辨认 | 无 |
| `--source-name <name>` | 信息源名称，写入本地队列 | 无 |
| `--url <url>` | 原文链接，写入本地队列 | 无 |
| `--no-wait` | 只发起不等待，立刻返回 | 前台等待 |
| `--timeout <sec>` | 等待上限秒数，1–600 | `180` |
| `--brief` | 精简输出：省略正文部分 | 全量 |

精读通常需要几十秒完成，所以默认前台等待。

```shell
supsub deepread run --type MP --content-id <cid> --title "标题"
supsub deepread run --type MP --content-id <cid> --no-wait   # 批量发起，稍后收割
```

::: tip 超时不是错误
`status` 取值为 `none` / `pending` / `done` / `failed`。**超时或仍 `pending` 时退出码仍是 `0`** —— 调用方按 `status` 字段分支，不要靠退出码判断精读是否完成。
:::

## `supsub deepread get` — 查看结果

| 选项 | 说明 | 默认 |
|---|---|---|
| `--type` / `--content-id` | 定位文章 | **必填** |
| `--refresh` | 忽略本地缓存，强制回服务端查 | 用缓存 |
| `--wait` | `pending` 时等到落定 | 不等 |
| `--timeout <sec>` | 等待上限秒数 | `180` |
| `--brief` | 省略正文部分 | 全量 |
| `--out <file>` | 把精读全文导出为 Markdown 文件 | 不导出 |
| `--title` / `--source-name` / `--url` | 补写进本地缓存 | 无 |

已完成的精读结果不会再变化，默认直接使用本地缓存；需要重新向服务端确认时加 `--refresh`。

## `supsub deepread list` — 本地队列

| 选项 | 说明 |
|---|---|
| `--all` | 显示全部历史记录 |
| `--wait` | 等到队列里所有进行中的精读都落定 |
| `--timeout <sec>` | 等待上限秒数（默认 `180`，上限 600） |

默认只显示「进行中」+「完成但尚未看过」的条目——收件箱语义，适合 `--no-wait` 批量发起后回来收割；`--all` 则不影响后续默认视图。

## `supsub deepread quota` — 额度

返回本月 `{limit, used, remaining}`。

## `supsub deepread share` / `show` — 分享

```shell
supsub deepread share --type MP --content-id <cid>   # → <web>/s/<code>
supsub deepread show --share-code <code>             # 看别人分享的，无需登录
```

::: danger 分享链接公开且不可撤销
`<web>/s/<code>` 页面**任何人都能访问**，当前 API 没有撤销接口。同一篇重复 `share` 会复用已有分享码。Web 基址由 [`SUPSUB_WEB_URL`](/reference/env) 决定，未设时跟随 API 基址。
:::

## `supsub deepread drop` — 移出本地队列

只删本地记录，服务端结果不受影响；之后 `get` 能重新拉回，且不扣额度。

## 本地缓存 / 队列

每篇精读会在 `~/.supsub/deepread/` 下保存一份本地副本（含可直接阅读的 Markdown），按账号分目录。**队列是本机本地的**，与网页端的「稍后阅读」、其它设备互不可见。
