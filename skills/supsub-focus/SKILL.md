---
name: supsub-focus
version: 0.1.0
description: SupSub 关注点（focus）管理 —— 列出我的关注点、查看某个关注点里聚合的内容/文章（按已读/未读筛选）、删除关注点。匹配「我的关注点」「关注点列表」「看 X 关注点里有哪些内容/文章」「关注点 X 有哪些未读」「关注点还有多少没读」「删除关注点 X」。关注点是跨多来源（公众号 MP / 网站 WEBSITE / 推特 X）按主题聚合的内容流。⚠️ 「关注点」专指这种带 AI 聚合的主题流；用户说「我关注了哪些（号 / 公众号）」一般是在问订阅，应走 supsub-sub——只有明确出现「关注点」三字才走本 skill。不用于订阅源的增删查（走 supsub-sub），也不用于全文关键词搜索（走 supsub-search）。CLI 没有新增关注点的命令，删除不可逆。
---

# supsub-focus Skill

「关注点」（focus）是 SupSub 里按主题聚合的内容流：它跨多个来源（微信公众号 `MP`、网站 `WEBSITE`、推特 `X`）把同一主题的文章汇集到一起。本 skill 负责**查看**关注点列表、**浏览**某个关注点里的内容（区分已读/未读），以及**删除**关注点。

> 与 `supsub-sub` 的区别：`sub` 管理「订阅源」（一个具体的公众号/网站，以及其下文章）；`focus` 管理「主题聚合视图」（跨多个源的内容流）。两者不要混淆。
> 与 `supsub-search` 的区别：`search` 是按关键词做一次性全文检索；`focus` 是浏览既有的、持续更新的主题流。

## Prerequisites

- 安装：`pnpm add -g @supsub/cli`（或 `npm i -g @supsub/cli`）
- 已登录：`supsub auth status` 显示 Authenticated（首次使用先 `supsub auth login`）

## Commands

### List focuses（关注点列表）

```
supsub focus list
```

无参数。每行字段：`id`, `icon`(emoji), `title`, `unreadCount`。

```bash
# 列出全部关注点
supsub focus list

# JSON 输出
supsub focus list -o json
```

JSON shape: `{"success":true,"data":[{"id":42,"icon":"🤖","title":"...","unreadCount":3}, ...]}`

> **已读/未读**：每个关注点的 `unreadCount` 就是该关注点当前的未读条目数。用户问「我哪个关注点还有没读的 / 各关注点还剩多少没看」时，直接读这个字段，无需进 contents。

---

### Browse contents in a focus（查看关注点内容）

```
supsub focus contents --id <focusId> [--unread | --all]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--id` | required | 关注点 ID（正整数），来自 `supsub focus list` 的 `id` |
| `--unread` | (default) | 仅返回未读内容 |
| `--all` | — | 返回全部内容（已读 + 未读） |

> ⚠️ `--unread` 与 `--all` **互斥**：同时指定会抛 `INVALID_ARGS`。不传任何一个时，默认行为等价于 `--unread`。

关注点聚合多来源，故每行都带 `sourceType` / `sourceName`，便于看清这条内容来自哪个号/网站/推特。

每行字段：`articleId`, `url`, `title`, `coverImage`, `keywords[]`, `tags[]`, `summary`, `sourceType`, `sourceName`, `publishedAt`, `isRead`。

```bash
# 默认（仅未读）—— 等价于 --unread
supsub focus contents --id 42

# 全部内容（含已读）
supsub focus contents --id 42 --all

# 全部 + JSON
supsub focus contents --id 42 --all -o json
```

JSON shape: `{"success":true,"data":[{"articleId":"...","url":"...","title":"...","coverImage":"...","keywords":[...],"tags":[...],"summary":"...","sourceType":"MP","sourceName":"...","publishedAt":<timestamp 或字符串>,"isRead":false}, ...]}`

> 注意 `publishedAt` 可能是 Unix 秒级时间戳（数字）或 `"YYYY-MM-DD HH:mm:ss"` 字符串，取决于后端版本，调用方需兼容两种类型。`sourceType` 可能是 `MP` / `WEBSITE` / `X`（推特）。

---

### Remove a focus（删除关注点）

```
supsub focus remove --id <focusId>
```

| Flag | Required | Description |
|------|----------|-------------|
| `--id` | yes | 关注点 ID（正整数） |

```bash
supsub focus remove --id 42
supsub focus remove --id 42 -o json
```

JSON shape: `{"success":true,"data":{"message":"..."}}`

> ⚠️ **破坏性且不可逆**：删除后 CLI **没有任何新增关注点的命令**（无 `focus add`），删掉就建不回来。执行前务必向用户确认。

---

## 已读 / 未读（重点）

SupSub 的已读状态由**服务端维护**，CLI 只能读取、解释这些字段，**不能修改**：

- `focus list` 每项的 `unreadCount` = 该关注点的未读条目数。这是判断「哪个关注点还有没看的」的最快入口。
- `focus contents` 默认（或显式 `--unread`）只返回未读条目；`--all` 返回全部（已读 + 未读）。
- `focus contents` 每条的 `isRead`（布尔）= 该条目是否已读：表格里渲染为 `read` 列（已读显示 `✓`，未读为空）。
- **CLI 没有 mark-as-read 命令**（focus 维度不提供标记已读能力），agent 无法把某条标成已读；只能读取/汇报这些状态。用户若要求「把关注点 X 标记为已读」，应说明 CLI 不支持，需到 SupSub 网页/App 操作。

## Agent Usage Notes

- 解析数据时统一用 `-o json`；表格输出有截断、列宽限制，不适合做下游处理。
- 所有 JSON 响应都是 `{"success":true,"data":<payload>}` 结构（来自 `src/ui/output.ts`）。
- 拿 `focusId` 的唯一来源是 `supsub focus list` 的 `id`（正整数）；`--id` 非正整数会报 `INVALID_ARGS` (exit 64)，且不会发起请求。
- 用户问「这个关注点里都有哪些内容/文章」通常意味着 `--all`（含已读）；问「还有哪些没看 / 未读」用默认 `--unread`。
- `focus contents` 一次最多返回 20 条（后端默认 `pageSize=20`），CLI 不支持翻页；想看更早的历史目前没有 CLI 命令可达。
- **本 skill 不负责**：订阅源增删查（→ `supsub-sub`）、按关键词全文搜索（→ `supsub-search`）、发现新公众号（→ `supsub-mp`）。focus 没有 add。
- Exit codes：`0` OK，`2` UNAUTHORIZED，`64` INVALID_ARGS（`--id` 校验失败、`--all` 与 `--unread` 互斥），其他网络/服务端错误 `10` / `11`。
