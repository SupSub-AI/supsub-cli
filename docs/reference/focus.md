# `focus` 关注点

关注点 = 用户自定义的主题方向（带 AI 聚合，跨多个来源），按 `focus id` 定位。

::: warning CLI 无新增关注点能力
关注点只能在**网页端**创建。CLI 有 `focus remove` 但没有 `focus add`——删掉只能回网页端重建。
:::

## `focus list` — 列出关注点

无选项。输出列：`id`、`icon`、`title`、`unreadCount`。

## `focus contents` — 查看关注点内容

| 选项 | 说明 |
|---|---|
| `--id <focusId>` | 必填 |
| `--unread` | 仅未读（默认） |
| `--all` | 全部内容（与 `--unread` 互斥） |
| `--brief` | 精简输出：只留 `contentId` / `title` / 来源 / 发布时间 / 已读状态 |
| `--page <n>` | 页码（默认 `1`） |
| `--page-size <n>` | 每页条数 `1`-`100`（默认 `20`） |

输出列：`publishedAt`、`read`、`title`、`sourceType`、`sourceName`、`contentId`、`url`；`--brief` 时为 `publishedAt`、`read`、`title`、`sourceName`、`contentId`。

::: warning 默认只返回未读
同 `sub contents`：按时间浏览要加 `--all`。
:::

## `focus mark-read` — 整个关注点标记已读

| 选项 | 说明 |
|---|---|
| `--id <focusId>` | 必填 |
| `--all` | **必填**，确认把整个关注点标为已读 |

::: danger 不可逆
与 `sub mark-read` 同样的模型：**只有整体已读，没有单篇已读**，`--all` 必填且不可逆。传 `--content-id` / `--type` / `--source-type` 会以退出码 `64` 报错。
:::

## `focus remove` — 删除关注点

| 选项 | 说明 |
|---|---|
| `--id <focusId>` | 必填 |

::: danger 破坏性且不可逆
CLI 没有新增关注点的命令，删掉只能回网页端重建。
:::
