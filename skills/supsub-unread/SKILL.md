---
name: supsub-unread
version: 0.1.1
description: SupSub 未读管理（工作流）—— 一条命令看全所有订阅源与关注点的未读数（supsub unread），钻取未读文章列表（sub contents / focus contents，支持 --page 翻页），并把某个订阅源 / 某个关注点**整体**标记已读（sub mark-read --all / focus mark-read --all）。匹配「我还有什么没读 / 没看的」「有多少未读」「未读概览」「哪些号还有没读的」「帮我清未读」「这个号我读完了」「这个关注点全部标记已读」「全部已读」。⚠️ 标记已读**只有整源 / 整个关注点一档**，不支持单篇：文章没有「详情 / 阅读」这一步，产生不了自然的单篇已读事件。⚠️ `--all` 标记已读**不可逆**（无 mark-as-unread 命令），执行前必须向用户二次确认。只是浏览某个源 / 关注点的文章列表走 supsub-sub / supsub-focus；分组维度的未读数走 supsub-group（group subs）。
---

# supsub-unread Skill

未读工作流的**入口 skill**：回答「我有哪些未读」，并完成「概览 → 钻取 → 整体已读」的闭环。涉及的命令跨 `unread` / `sub` / `focus` 三个命令树，本文档按工作流组织。

## Prerequisites

- 安装：`pnpm add -g @supsub/cli`（或 `npm i -g @supsub/cli`）
- 已登录：`supsub auth status` 显示 Authenticated（首次使用先 `supsub auth login`）
- **未授权（exit 2 / UNAUTHORIZED）时不要止步于「你未登录」**：直接运行 `supsub auth login` 为用户打开浏览器授权（命令会自动打开浏览器并阻塞等待授权，请用足够长的超时，如 10 分钟；用户只需在浏览器点确认，无需在终端输入任何内容），授权成功后重试原命令。无浏览器 / 无头环境再回退为提示用户 `SUPSUB_NO_BROWSER=1 supsub auth login`。

## 已读模型：只有「整体已读」，没有「单篇已读」

这是本 skill 最容易踩错的一点，先记住：

- **CLI 能做的只有两件事**：`sub mark-read --all`（这个号我读完了）、`focus mark-read --all`（这个关注点我看完了）。
- **没有单篇已读**。原因是产品侧的：文章在 SupSub 里没有「详情 / 阅读」这一步，也就不存在「用户读完了这一篇」的自然事件，所以 CLI 只保留用户**明确表达**的整体已读意图。
- 用户说「把这篇标为已读」时：**如实说明不支持**，再问是否要把整个源 / 整个关注点标为已读。不要试图用 `--content-id` 绕过（会抛 `INVALID_ARGS`），也不要靠循环调用伪造逐篇已读。
- 也没有分组级已读命令。用户要「清空某个分组」时：先 `group subs` 列出组内源，逐个源确认后再逐个 `sub mark-read --all`，**每个源都要在确认范围内**。

## Workflow（三步闭环）

1. **概览**：`supsub unread -o json` → 一次拿到所有 `unreadCount > 0` 的订阅源与关注点。
2. **钻取**：对用户关心的源/关注点拉未读列表（默认就是未读）：
   - 订阅源 → `supsub sub contents --source-id <sid> --type <t> -o json`
   - 关注点 → `supsub focus contents --id <fid> -o json`
   > 这里用默认（未读）是对的——本 skill 的语境本来就是「我有什么没读」。但若用户中途转成**按时间浏览**
   > （「那 X 最近都讲了什么」），要改用 `--all` 并把 `isRead` 当标注，详见 `supsub-sub` / `supsub-focus`。
3. **整体已读**（仅当用户明确表达「读完了 / 清掉」时）：`mark-read --all`，**必须先二次确认**（见下）。

### 翻页策略（不要反复询问用户）

`contents` 默认一页 20 条（`--page-size` 上限 100）。按用户意图选择策略，**过程中不逐页询问**：

- **浏览类意图**（「看看有什么未读」）：只拉第 1 页，结合 `unreadCount` 告知「共 N 条未读，已显示前 20 条」；用户说「继续 / 看更多」再 `--page 2`。
- **全量类意图**（「全部未读」「统计 / 导出」）：自动循环翻页——用 `--page-size 100` 减少请求数，返回条数 < page-size 即最后一页；`unreadCount` 可预估页数。**这类批量拉取一律加 `--brief`**（只留 contentId/title/时间/已读状态，100 条约 14KB；不加约 90KB，会撑爆工具输出上限被迫落盘）。
- 注意：「清未读」**不需要**先把文章全部拉下来——整体已读是一条命令的事，拉全量只在用户要看 / 要统计时才做。

### `--all` 二次确认（强制规则）

执行 `sub mark-read --all` 或 `focus mark-read --all` 前，**必须**依次完成：

1. **复述影响范围**：源/关注点名称 + 当前 `unreadCount`（从 `supsub unread` 或 list 命令取）；
2. **明确询问用户**并获得肯定答复；
3. 才可执行。**未经确认不得执行**——操作不可逆，没有 mark-as-unread。

用户笼统说「都标已读 / 清未读」时：先展示未读概览，**逐项确认**，不要自作主张把所有源循环清一遍。

## Commands

### Unread overview（未读概览）

```
supsub unread [--all]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--all` | — | 显示全部（含 `unreadCount=0` 的项）；默认只显示有未读的 |

一次并发聚合「订阅源列表 + 关注点列表」，等价于 `sub list` + `focus list` 两查。

```bash
supsub unread
supsub unread -o json
supsub unread --all -o json
```

JSON shape: `{"success":true,"data":{"subscriptions":[{"sourceType":"MP","sourceId":25,"name":"量子位","unreadCount":194,...}],"focuses":[{"id":674,"icon":"🔖","title":"...","unreadCount":299}]}}`

---

### Mark a source as read（订阅源整源已读）

```
supsub sub mark-read --source-id <sid> --type <MP|WEBSITE|X> --all
```

| Flag | Required | Description |
|------|----------|-------------|
| `--source-id` | yes | 信息源 ID（正整数） |
| `--type` | yes | `MP` / `WEBSITE` / `X`（推特） |
| `--all` | yes | 确认整源全部标为已读（**不可逆，先二次确认**） |

> `--all` 是**必填**的意图标记：不给会抛 `INVALID_ARGS`，避免误触把一个源清空。传 `--content-id` 同样抛 `INVALID_ARGS`（无单篇已读）。

```bash
# 整源已读（需用户确认后执行）
supsub sub mark-read --source-id 25 --type MP --all -o json
```

JSON shape: `{"success":true,"data":{"message":"已标记该订阅源全部内容为已读（不可逆）"}}`

---

### Mark a focus as read（关注点整体已读）

```
supsub focus mark-read --id <fid> --all
```

| Flag | Required | Description |
|------|----------|-------------|
| `--id` | yes | 关注点 ID（正整数，来自 `focus list`） |
| `--all` | yes | 确认整个关注点全部标为已读（**不可逆，先二次确认**） |

> 同样：`--all` 必填；传 `--content-id` / `--type` / `--source-type` 抛 `INVALID_ARGS`（无单篇已读）。

```bash
# 整个关注点已读（需用户确认后执行）
supsub focus mark-read --id 674 --all -o json
```

JSON shape: `{"success":true,"data":{"message":"已标记该关注点全部内容为已读（不可逆）"}}`

---

## Agent Usage Notes

- 解析数据时统一用 `-o json`；所有 JSON 响应都是 `{"success":true,"data":<payload>}` 结构。
- `supsub unread` 是「有什么没读」类请求的**首选第一步**：一条命令顶两查，且默认只回有未读的项，直接可汇报。
- **标记已读只有整源 / 整个关注点两条路径**，都要 `--all`。用户要标单篇时如实说明不支持，并给出「整源已读」这个替代选项让他决定。
- **`--all` 必须先向用户二次确认**（复述范围 + 未读数 → 明确同意 → 执行）；标记完成后复述实际执行的范围，可用 `supsub unread` 复查归零。
- 没有 mark-as-unread：标错了无法恢复。宁可一次只清一个源，也不要批量循环。
- **本 skill 不负责**：订阅/退订（→ `supsub-sub`）、关注点删除（→ `supsub-focus`）、分组管理（→ `supsub-group`）、关键词搜索（→ `supsub-search`）。
- Exit codes：`0` OK，`2` UNAUTHORIZED，`64` INVALID_ARGS（未给 `--all`、误传单篇参数、ID 非法），`10` 网络错误，`11` 服务端/业务错误。
