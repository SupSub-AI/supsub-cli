# `deepread` 精读

对**单篇**文章做 AI 深度拆解，产出「一句话本质 / 干货成色 / 核心要点 / 分节正文 / 编辑批注（背景 · 立场 · 来源可信度 · 最弱一环）」。

::: warning 按次消耗月度额度
实测 `limit=100`，**没有退额度操作**。已精读过的文章重复发起不会重复扣费。
:::

精读 ≠ 摘要（`sub contents` 的 `summary` 已经是摘要），也 ≠ 全文（CLI 没有取原文的接口）。

| 命令 | 功能 |
|---|---|
| `supsub deepread run` | 发起精读。先探测状态，`none` / `failed` 才真正发起；默认前台轮询到完成 |
| `supsub deepread get` | 查看结果。`done` 是终态、结果不可变，默认直接用本地缓存（零请求） |
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
| `--brief` | 精简输出：省略正文 sections | 全量 |

实测精读耗时约 20~40 秒，所以默认前台等待（3 秒轮询）。

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
| `--brief` | 省略正文 sections | 全量 |
| `--out <file>` | 把精读全文导出为 Markdown 文件 | 不导出 |
| `--title` / `--source-name` / `--url` | 补写进本地缓存 | 无 |

`done` 是终态且结果不可变，所以命中本地缓存时零请求。

## `supsub deepread list` — 本地队列

| 选项 | 说明 |
|---|---|
| `--all` | 显示全部历史记录（且**不写**播报水位线） |
| `--wait` | 等到队列里所有进行中的精读都落定 |
| `--timeout <sec>` | 等待上限秒数（默认 `180`，上限 600） |

默认只显示「进行中」+「完成但尚未播报过」的条目，播报后打水位线——收件箱语义，适合 `--no-wait` 批量发起后回来收割。

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

后端没有「列出我所有精读」的接口，裸发起的精读也**不会**进网页端的「稍后阅读」列表，所以 CLI 自建本地索引：

```
~/.supsub/deepread/<账号>/<TYPE>_<hash>.json   完整记录（元数据 + 精读结果）
~/.supsub/deepread/<账号>/<TYPE>_<hash>.md     渲染好的 Markdown 全文
```

一条一个文件（并发发起不会互相覆盖），按账号分目录。**队列是本机本地的**，与网页端、其它设备互不可见。
