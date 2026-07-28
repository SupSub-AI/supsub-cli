# `unread` 未读概览

## `supsub unread` — 一条命令看全未读

| 选项 | 说明 |
|---|---|
| `--all` | 显示全部（含 `unreadCount = 0` 的项）；默认只显示有未读的 |

一次给出「订阅源 + 关注点」两类未读概览。输出分两段：

- **订阅源**：`sourceId`、`类型`、`name`、`unreadCount`
- **关注点**：`id`、`icon`、`title`、`unreadCount`

```shell
supsub unread          # 只看有未读的
supsub unread --all    # 含已清空的项
```

## 配套的清未读动作

只有两条，均不可逆：

```shell
supsub sub mark-read --source-id <id> --type <t> --all   # 整个源
supsub focus mark-read --id <focusId> --all              # 整个关注点
```

::: danger 没有单篇已读，也没有分组级已读
详见[核心概念 · 未读模型](/guide/concepts#未读模型)。
:::
