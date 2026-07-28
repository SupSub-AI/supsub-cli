# 核心概念

SupSub 里有三类「我在追的东西」，名字相近但完全不同。搞混它们是使用 CLI 时最常见的困惑来源。

## 订阅源 / 关注点 / 分组

| | 订阅源 `sub` | 关注点 `focus` | 分组 `group` |
|---|---|---|---|
| **是什么** | 一个具体的号：公众号 / 网站 / 推特账号 | 用户自定义的主题方向，带 AI 聚合，跨多个来源 | 收纳已订阅源的「文件夹」 |
| **成员是** | 文章 | 文章（跨源聚合） | **订阅源**，不是文章 |
| **怎么定位** | `--source-id` + `--type` | `--id`（focus id） | `--id`（group id） |
| **列表项形如** | `{sourceId, type, name}` | `{id, icon, title}` | `{id, name}` |
| **举例** | 「阮一峰的网络日志」 | 「Agent 行业落地」 | 「AI」「前端」 |
| **能否在 CLI 新建** | 能（`sub add`） | **不能**，只能在网页端创建 | 能（`group add`） |

**判别动词**：

- 「订阅 / 订阅了」→ 订阅源，用 [`sub`](/reference/sub)
- 「关注 / 关注了 / 关注点」→ 关注点，用 [`focus`](/reference/focus)
- 「分组 / 分类 / 文件夹 / 归到…里」→ 分组，用 [`group`](/reference/group)

::: warning 关注点删除不可逆
CLI 有 `focus remove` 但**没有**新增关注点的命令。删掉之后只能回网页端重建。
:::

## 两个 ID 空间

公众号有两个不能互换的 ID：

| ID | 形态 | 来自 | 用在 |
|---|---|---|---|
| `mpId` | base64 串，如 `MzkyNTYzODk0NQ==` | [`mp search`](/reference/mp) | `sub add --mp-id` |
| `sourceId` | 站内正整数，如 `12345` | [`sub list`](/reference/sub) / [`search`](/reference/search) | 其余所有命令 |

订阅一个新公众号时用 `mpId`；订阅之后的日常操作（看文章、标已读、退订、加分组）一律用 `sourceId`。

## 信息源类型 `--type`

全 CLI 统一取值，大小写不敏感：

| 值 | 含义 |
|---|---|
| `MP` | 公众号 |
| `WEBSITE` | 网站 |
| `X` | 推特 / Twitter（后端只认 `X`，**不认** `TWITTER`） |

`group subs --type` 的取值更宽，额外接受 `PODCAST`（播客）与 `NEWSLETTER`（通讯）——分组里可能有从网页端加入的这两类源。

## 未读模型

- 每个订阅源和关注点都带 `unreadCount`。[`supsub unread`](/reference/unread) 一条命令聚合两者，给出全局未读概览。
- **标记已读只有两档**：`sub mark-read --all`（整个源）和 `focus mark-read --all`（整个关注点）。
- **没有单篇已读**。文章在 SupSub 里没有「详情 / 阅读」这一步，产生不了自然的单篇已读事件，所以 CLI 只保留用户明确表达的「这个号我读完了」。传 `--content-id` 会以退出码 `64` 报错。
- **没有分组级已读**。要清空一个分组，先 `group subs` 列出成员，再逐个 `sub mark-read --all`。
- **不可逆**：后端没有 mark-as-unread。这正是 `--all` 必填的原因——让清空一个源始终是明确动作而非误触。

## 「最近」不等于「未读」

`sub contents` 和 `focus contents` **默认只返回未读**。

```shell
# ❌ 这个源读完后会返回空列表，看起来像「没有内容」
supsub sub contents --source-id 12345 --type MP

# ✅ 按时间浏览「最近有什么」，把已读状态当标注而非过滤条件
supsub sub contents --source-id 12345 --type MP --all
```

只有当你确实想要「还没看的」时，才用默认的未读过滤。

## 搜索的范围

[`supsub search`](/reference/search) 是**全站**搜索，不限于你自己的订阅。

CLI **没有**「在我的订阅范围内按关键词全文搜」的命令。想限定在自己的范围内，走列表 / 浏览命令：`sub list`、`sub contents`、`focus list`、`focus contents`。
