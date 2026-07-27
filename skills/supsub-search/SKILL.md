---
name: supsub-search
version: 0.1.2
description: SupSub 全文搜索 —— 在订阅源（公众号 / 网站）和文章正文里跨源搜索内容。用户说「搜一下 X 相关的内容 / 文章」「在 supsub 里搜 X」「查 X 相关文章」「全文搜索 X」「找 X 的内容」「search articles/content in SupSub」时使用本 skill。⚠️ 范围判定看**动词意图**：「搜 / 查 / 全文搜 X」是检索意图 → 走本 skill（全站）；但「**看一下最近 X 的内容**」「X 最近有什么」「X 更新了吗」是**浏览某个主体的内容流**，必须先用 `supsub sub list` / `supsub focus list` 比对 X 是不是用户已订阅的源名或关注点标题，命中就改走 supsub-sub / supsub-focus，**不要直接全站搜**。若用户明确说「我的订阅 / 我的公众号 / 我的网站」→ supsub-sub，「我的关注点」→ supsub-focus。注意：本 skill 用于搜「内容 / 文章 / 订阅源标题」；如果用户想发现一个新的微信公众号本身（拿 mpId 准备订阅），改用 supsub-mp。
---

# supsub-search Skill

全量搜索：在订阅源（公众号、网站）和文章正文里同时搜，可按类型缩小范围。

## 先判范围：全站搜索 vs 用户自己的订阅

拿到一个词 X，**看动词，不看 X 像不像专名**：

| 用户说法 | 意图 | 走哪 |
|---|---|---|
| 「搜一下 X」「查 X 相关文章」「全文搜 X」 | 检索 | **本 skill**（全站） |
| 「看一下最近 X 的内容」「X 最近有什么」「X 更新了吗」「读读 X」 | 浏览某主体的内容流 | **先比对订阅范围**（见下） |
| 「我的订阅 / 我的公众号 / 我的网站」 | 已限定本人范围 | `supsub-sub` |
| 「我的关注点」 | 已限定本人范围 | `supsub-focus` |

浏览意图的处理步骤：

1. `supsub sub list -o json` + `supsub focus list -o json`；
2. 把 X 与 `name` / `title` 做**包含匹配（忽略大小写）**；
3. 命中订阅源 → `supsub sub contents --source-id <sid> --type <t>`；命中关注点 → `supsub focus contents --id <fid>`；**两边都命中就都列出来让用户选**（同一个词很可能既是源名又是关注点主题）；
4. 命中后补一句「也可以全站搜 X 相关文章」，别把全局搜索这条路藏起来；
5. 一个都没命中 → **直接执行 `supsub search <X>` 全站搜索，不要反问「要不要我帮你搜一下」**。用户的浏览意图没有变，只是这个词不在他的订阅里；正确做法是搜完再说明「你没有订阅叫 X 的源，以下是全站结果」。

> **实测教训**：「看一下最近 Anthropic 的内容」曾被直接送进全站 search，返回一堆第三方评论文章，而用户自己订阅的 Anthropic 官方博客源、以及「Anthropic 公司动态与 AI 前沿进展」关注点被完全绕过。用户提某个主体名时，**他自己订阅的那份优先**。

## Prerequisites

- 安装：`pnpm add -g @supsub/cli`（或 `npm i -g @supsub/cli`）
- 已登录：`supsub auth status` 显示 Authenticated（首次使用先 `supsub auth login`）
- **未授权（exit 2 / UNAUTHORIZED）时不要止步于「你未登录」**：直接运行 `supsub auth login` 为用户打开浏览器授权（命令会自动打开浏览器并阻塞等待授权，请用足够长的超时，如 10 分钟；用户只需在浏览器点确认，无需在终端输入任何内容），授权成功后重试原命令。无浏览器 / 无头环境再回退为提示用户 `SUPSUB_NO_BROWSER=1 supsub auth login`。

## Commands

### Search

```
supsub search <keyword> [--type <ALL|MP|WEBSITE|CONTENT>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--type` | `ALL` | 搜索范围：`ALL`（源 + 文章）/ `MP`（公众号源）/ `WEBSITE`（网站源）/ `CONTENT`（文章正文） |

`<keyword>` 是位置参数，可以是中文或英文，建议用引号包起来避免 shell 拆分。

```bash
# 全量搜索（默认 ALL：同时搜源 + 文章）
supsub search "RAG"

# 只搜公众号
supsub search "阮一峰" --type MP

# 只搜网站
supsub search "hacker news" --type WEBSITE

# 只搜文章正文
supsub search "向量数据库" --type CONTENT

# JSON
supsub search "MCP 协议" -o json
```

JSON shape: `{"success":true,"data":{"results":[...],"recommendations":[...],"prompts":[...]}}`

`results` 是异质数组，每条形如：

```json
// 源结果（type=MP 或 WEBSITE 时）
{ "type": "SOURCE", "data": { "sourceType": "MP", "sourceId": 12345, "isSubscribed": false, "img": "...", "name": "...", "description": "...", "introduction": "...", "url": "..." } }

// 文章结果（type=CONTENT 时）
{ "type": "CONTENT", "data": { "contentId": "...", "title": "...", "summary": "...", "url": "...", "coverImage": "...", "publishedAt": 1700000000, "sourceId": 12345, "sourceName": "...", "sourceType": "MP", "isSubscribed": false, "keywords": [...], "tags": [...] } }
```

`recommendations` 是后端推荐的相关源（`SourceBasic[]`），`prompts` 是后端给的搜索建议词。

---

## Agent Usage Notes

- 解析结构化结果时统一用 `-o json`：`results[]` 是 `{type, data}` 联合类型，先看 `type` 再访问 `data` 字段。
- `--type ALL`（默认）会同时返回源 + 文章混排；想精确控制结果类型时显式指定 `MP` / `WEBSITE` / `CONTENT`。
- 搜索 + 订阅典型链路：`supsub search "<词>" --type MP -o json` → 取 `data.results[].data.sourceId` → `supsub sub add --source-id <id> --type MP`（参考 `supsub-sub` skill）。
- 搜文章拿全文：`supsub search "<词>" --type CONTENT -o json` 拿到 `contentId` 与 `sourceId`，目前 CLI 没有"按 contentId 取文章详情"命令，需要通过 `supsub sub contents --source-id <id> --type <T>` 在该源内浏览。
- `data.results[].data.isSubscribed` 字段可以判断当前结果是否已经订阅，避免重复 `sub add`。
- CLI 一次最多返回 10 条结果（后端默认 `pageSize=10`），不支持翻页；如果想要更多结果，调整关键词缩小或扩大搜索范围。
- Exit codes：`0` OK，`2` UNAUTHORIZED，`64` INVALID_ARGS（`--type` 不在白名单时），`10`/`11` 网络/服务端错误。
