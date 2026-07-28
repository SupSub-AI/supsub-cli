# `search` 搜索

## `supsub search <keyword>` — 全站搜索（源 + 文章）

| 选项 | 说明 | 默认 |
|---|---|---|
| `--type <ALL\|MP\|WEBSITE\|CONTENT>` | 搜索范围：全部 / 公众号 / 网站 / 文章正文 | `ALL` |

输出同时包含「源」与「文章」两类结果，每条带类型、ID、名称/标题、域名、摘要。

```shell
supsub search "AI"
supsub search "Agent" --type MP
supsub search "Claude" --type CONTENT
```

## JSON 输出里的时间字段

`-o json` 时，`CONTENT` 结果在原始 `publishedAt`（Unix 秒）之外额外带 `publishedAtText`（`"YYYY-MM-DD HH:mm"`），与 `sub contents` / `focus contents` 一致，调用方不必自己转时间戳；`SOURCE` 结果没有发布时间，不带该字段。

## 这是全站搜索

::: warning 不限于自己的订阅
CLI **没有**「在我的订阅范围内按关键词搜」的命令。限定到自己范围的请求走 `sub list` / `sub contents` / `focus list` / `focus contents` 浏览。
:::

## 与 `mp search` 的区别

| 想做的事 | 用哪个 |
|---|---|
| 按关键词找**文章 / 内容** | `supsub search <kw>` |
| 找一个**具体的公众号账号**（准备订阅但不知道 ID） | [`supsub mp search <name>`](./mp) |

话题词（「大模型」「RAG」「AI agent」）属于内容搜索，走 `search`，不要送进 `mp search`。
