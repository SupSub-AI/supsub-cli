# `sub` 订阅源

订阅源 = 一个具体的号（公众号 / 网站 / 推特账号），按 `sourceId` + `sourceType` 定位。

## `sub list` — 列出订阅源

| 选项 | 说明 |
|---|---|
| `--type <MP\|WEBSITE\|X>` | 按类型过滤（可选） |

输出列：`sourceId`、`类型`、`name`、`description`，末尾显示总条数。`-o json` 的每项还带 `unreadCount`（未读数）。

```shell
supsub sub list
supsub sub list --type WEBSITE
```

## `sub add` — 添加订阅

`--source-id` 与 `--mp-id` **二选一、互斥**。

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 内部信息源 ID（正整数，来自 `search` / `sub list`）；**必须配合 `--type`** |
| `--mp-id <mpId>` | 公众号 mpId（base64，来自 `mp search`）；`--type` 可省，默认 `MP` |
| `--type <MP\|WEBSITE\|X>` | 信息源类型 |
| `--group <gid>` | 分组 ID，可重复指定以加入多个分组 |

::: warning 两个 ID 空间不可互换
`--source-id` 是站内正整数，`--mp-id` 是微信原生 base64 串，二者不是同一个东西。
:::

```shell
supsub sub add --mp-id "MzkyNTYzODk0NQ=="
supsub sub add --source-id 12345 --type WEBSITE --group 7 --group 9
```

## `sub remove` — 取消订阅

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 必填 |
| `--type <MP\|WEBSITE\|X>` | 必填 |

## `sub contents` — 查看订阅源内文章

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 必填（别名 `--id`，与 `focus contents --id` 写法对齐） |
| `--type <MP\|WEBSITE\|X>` | 必填 |
| `--unread` | 仅未读（默认） |
| `--all` | 全部文章（与 `--unread` 互斥） |
| `--brief` | 精简输出：只留 `contentId` / `title` / 发布时间 / 已读状态 |
| `--page <n>` | 页码（默认 `1`） |
| `--page-size <n>` | 每页条数 `1`-`100`（默认 `20`） |

输出列：`publishedAt`（`YYYY-MM-DD HH:mm`）、`read`（已读为 `✓`）、`title`、`contentId`、`url`；`--brief` 时去掉 `url` 列。

::: warning 默认只返回未读
要按时间浏览「最近有什么」需显式加 `--all`，否则该源读完后会返回空列表。
:::

## `sub mark-read` — 整源标记已读

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 必填 |
| `--type <MP\|WEBSITE\|X>` | 必填 |
| `--all` | **必填**，确认把该源全部内容标为已读 |

::: danger 只有整源已读，且不可逆
**没有单篇已读。** 文章在 SupSub 里没有「详情 / 阅读」这一步，产生不了自然的单篇已读事件，因此 CLI 只保留用户明确表达的「这个号我读完了」。传 `--content-id` 会以退出码 `64` 报错并说明原因。

**`--all` 必填且不可逆**：后端没有 mark-as-unread，标错无法恢复。要求显式给出 `--all`，是为了让「清空一个源」始终是一次明确动作而非误触。
:::
