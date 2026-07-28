# `group` 订阅分组

分组 = 收纳已订阅源的「文件夹」，成员是**源**而不是文章。

| 命令 | 功能 |
|---|---|
| `supsub group list` | 列出分组，输出列 `id`、`name` |
| `supsub group add <name>` | 创建分组，返回新分组的 `id` / `name` |
| `supsub group rename --id <id> --name <新名称>` | 重命名分组 |
| `supsub group remove --id <id>` | 删除分组（**不可逆**；组内订阅源本身不受影响，只是不再归属该分组） |
| `supsub group subs --id <id> [--all] [--type <t>]` | 查看分组订阅源 |
| `supsub group add-sub --id <id> --source-id <sid> --type <t>` | 把订阅源加入分组（幂等） |
| `supsub group remove-sub --id <id> --source-id <sid> --type <t>` | 把订阅源移出分组（幂等，**不会退订**） |

## `group subs` 的两种模式

- **默认**（仅组内成员）：输出列 `sourceId`、`类型`、`name`、`unreadCount`、`description`。
- **`--all`**（全部订阅源）：输出列 `sourceId`、`类型`、`name`、`inGroup`、`description`——这个模式下**没有** `unreadCount`，要未读数就用默认模式。
- `--type` 可过滤类型，取值比订阅命令更宽：`MP|WEBSITE|X|PODCAST|NEWSLETTER`（分组里可能有网页端加入的播客 / 通讯源）。

## 不要并发编辑同一分组

::: danger 后写入会覆盖先写入
`add-sub` / `remove-sub` 对分组成员是整体覆盖语义。**不要并发执行**，也不要在网页端同时编辑同一分组，否则后写入的一方会覆盖另一方的改动。
:::

## 没有分组级标记已读

要「清空某个分组」，先 `group subs` 列出成员与各自未读数，确认后逐个执行 `sub mark-read --all`。
