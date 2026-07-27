# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **READ THIS FIRST if you are answering an end-user natural-language SupSub request.**
> Many requests will look like "搜一下 X" / "查一下 X" — they are **not** about microblog accounts by default. Consult the routing table immediately below before doing anything else; do not skim source code in `src/commands/` to guess the command.

## End-user 意图 → 命令路由（最高优先级）

This section is the authoritative routing table for **end-user-style natural-language requests** about SupSub usage (登录 / 订阅 / 搜索 / 找公众号 …). The same mapping is encoded in `skills/*/SKILL.md`; this section exists so agents that don't pick up the marketplace skills (e.g. sub-agents inheriting CWD inside this repo) still route correctly. **Match the user's intent against this table first; only then look at command source if you need flag-level detail.**

| 用户意图 (中文) | Skill | 命令 |
|---|---|---|
| 登录 / 登出 / 查看登录状态 / 我现在用哪个账号 | `supsub-auth` | `supsub auth login` / `logout` / `status` |
| 列出订阅 / 我订阅了哪些 / 添加订阅 / 取消订阅 / 看某个订阅里有哪些文章 | `supsub-sub` | `supsub sub list` / `add` / `remove` / `contents`（订阅源类型 `MP`公众号 / `WEBSITE`网站 / `X`推特；contents 支持 `--page` / `--page-size`） |
| 我的关注点 / 关注点列表 / **我关注了哪些** / 看某个关注点里的内容（文章）/ 关注点有哪些未读 / 删除关注点 | `supsub-focus` | `supsub focus list` / `contents` / `remove`（**无新增**；删除不可逆） |
| 我的分组 / 新建（重命名 / 删除）分组 / 把某订阅加进（移出）分组 / 某分组里有哪些订阅、还有多少未读 / 整理订阅 | `supsub-group` | `supsub group list` / `add` / `rename` / `remove` / `subs` / `add-sub` / `remove-sub`（删除分组不可逆，**先与用户确认**；add-sub/remove-sub 是读-改-写全量覆盖，勿并发） |
| 我还有什么没读 / 有多少未读 / 未读概览 / 帮我清未读 / 这个号（这个关注点）我读完了 | `supsub-unread` | `supsub unread`；`supsub sub mark-read --all`；`supsub focus mark-read --all`（**只有整源/整关注点一档，无单篇已读**；不可逆、无取消已读，执行前必须二次确认） |
| **搜文章 / 搜内容 / 关键词找文章 / 全文搜 / 「搜一下 X」 / 「搜 X 相关的内容」** | `supsub-search` | `supsub search <kw> [--type ALL\|MP\|WEBSITE\|CONTENT]` |
| **发现一个具体公众号账号 / 「找 XXX 这个公众号」 / 想订阅某公众号但不知道 ID** | `supsub-mp` | `supsub mp search <name>` → 拿 `mpId` → `supsub sub add --mp-id <mpId>` |

> **订阅源（sub）vs 关注点（focus）vs 分组（group）** —— 三者都跟「我在追的东西」有关，但不同：**订阅源**是具体的一个号（公众号 / 网站 / 推特账号），按 `sourceId`+`sourceType` 操作；**关注点**是用户自定义的主题/关注方向（带 AI 聚合，列表项形如 `{id, icon, title}`，如「Agent 行业落地」），按 `focus id` 操作；**分组**是把已订阅的源收纳起来的「文件夹」（列表项形如 `{id, name}`），成员是源而不是文章，按 `group id` 操作。**判别动词**：「订阅 / 订阅了」→ `supsub-sub`（订阅源）；「关注 / 关注了 / 关注点」→ `supsub-focus`（关注点）；「分组 / 分类 / 文件夹 / 归到…里」→ `supsub-group`。即「我订阅了哪些」→ `supsub-sub`；「我关注了哪些」「我的关注点」→ `supsub-focus`；「我的分组」「把量子位加到 AI 分组」→ `supsub-group`。
>
> **未读（unread）的归属** —— 「我还有什么没读 / 清未读 / 标记已读」这类**跨源的未读工作流**走 `supsub-unread`（`supsub unread` 一条命令聚合订阅源 + 关注点的未读数）。若用户已限定到具体对象（「这个号还有几篇没看」「这个分组多少未读」），也可直接读 `sub list` / `focus list` / `group subs` 里的 `unreadCount` 字段。**标记已读只有 `sub mark-read --all`（整源）/ `focus mark-read --all`（整个关注点）两条路径，`--all` 必填且不可逆。没有单篇已读**——文章没有「详情 / 阅读」这一步，产生不了自然的单篇已读事件，用户要标单篇时如实说明并改问是否整源已读；**也没有分组级已读**，要清分组就 `group subs` 列出成员后逐个源确认执行。
>
> **⚠️ 字母「X」的两种含义** —— 路由示例里用「X」「XXX」当**占位符**代指用户的真实词/账号名（如「搜 X」「找 XXX 这个公众号」），它**不是**类型；而 `sub --type X` 里的 `X` 是真实 sourceType，专指**推特/Twitter 平台账号**（后端只认 `X`，不认 `TWITTER`）。只有用户**明确提到推特/Twitter/X 平台**时才用 `--type X`；「订阅 X」「X 公众号」这类占位用法不要推断成 `--type X`。
>
> **🔍 搜索范围判定（全局 vs 我的范围）** —— 拿到一个词 X，先看**动词意图**再决定范围，顺序如下：
> 1. **明确限定到本人范围 → 直接走对应 skill。** 出现「我的订阅」「我的公众号」「我的网站」「我的关注点」「我订阅的…」等限定词时：「我的订阅 / 公众号 / 网站」→ `supsub-sub`；「我的关注点」→ `supsub-focus`。
> 2. **浏览动词 + 主体名 → 先比对本人订阅范围（订阅优先）。** 「看一下最近 X 的内容」「X 最近有什么」「X 更新了吗」「读读 X」这类句式，用户要的是**某个主体的内容流**，不是关键词检索。先跑 `sub list` / `focus list`，把 X 与订阅源名 / 关注点标题做**包含匹配（忽略大小写）**：命中订阅源 → `sub contents`；命中关注点 → `focus contents`；两边都命中 → 都列出来让用户选。命中后**补一句「也可以全站搜 X 相关文章」**，别把全局搜索这条路藏起来。都没命中 → **直接执行第 3 条的全站搜索，不要反问「要不要我帮你搜」**（用户的浏览意图没变，只是这个词不在他的订阅里）。
> 3. **检索动词 + 任意词 → 全局搜索 `supsub search`（全站）。** 「搜一下 X」「查 X 相关文章」「全文搜 X」「找 X 的内容」都属此类；话题词（「大模型」「RAG」）天然走这里。
>
> 判别关键在**动词**，不在 X 像不像专名：「**搜**一下 Anthropic」→ 检索意图 → 全局 search；「**看一下最近** Anthropic 的内容」→ 浏览意图 → 若用户订阅了 Anthropic 就走 `sub contents`。**实测教训**：曾经把「看一下最近 Anthropic 的内容」直接送进全局 search，返回一堆第三方评论文章，而用户自己订阅的 Anthropic 官方博客源和「Anthropic 公司动态」关注点被完全绕过。
>
> **⏱ 「最近」不等于「未读」** —— `sub contents` / `focus contents` 默认只返回**未读**。但「看一下最近 X 的内容」「X 讲了什么」是**按时间浏览**，必须加 `--all`，把 `isRead` 当**标注**（「其中 3 篇你还没看过」）而不是过滤条件；否则该源读完后会返回空数组，回成「没有内容」——而用户问的是「最近」。只有用户明说「未读 / 没看的 / 清未读」才用默认过滤。
>
> 注意：CLI 没有「在我的某范围内按关键词全文搜」的命令——确定范围的请求落到对应 skill 的**列表 / 内容浏览**命令（`sub list`/`sub contents`/`focus list`/`focus contents`），全文关键词搜索只有全局 `supsub search` 一条路径。

### ⚠️ Decision rule for "搜 X" vs "搜公众号 X" — read carefully

The single most common mis-routing in this CLI is sending an article-content query into `mp search`. Stop and check the user's wording:

1. **Default verdict: `supsub search`.** Anything phrased as 「搜一下 X」「在 supsub 里搜 X」「搜 X 相关的内容 / 文章」「查 X 相关文章」「全文搜 X」 → `supsub search <kw>`. The keyword X being a trendy / general topic word (e.g. **「大模型」「RAG」「AI agent」「向量数据库」**) does **NOT** make it a 公众号 query — those are content topics. Pick `supsub search`.
2. **Override to `supsub mp search` ONLY IF** the user's sentence contains an explicit account-discovery signal:
   - 「公众号」 字样 (e.g. 「搜公众号 X」「找 X 这个公众号」「X 公众号」)
   - 「想订阅 X」 + 不知道 ID 的语境
   - 「这个号」「这个账号」 指代某个具体账号
3. **When ambiguous, choose `supsub search`** (article/content search). Account discovery via `mp search` is a narrower, opt-in path.

Examples (these have been tested and are the canonical answers — do not contradict them):

- 「在 supsub 里搜一下"大模型"相关的内容」 → `supsub search "大模型"` (NOT `mp search`)
- 「搜一下"阮一峰"这个公众号」 → `supsub mp search "阮一峰"` (explicit「公众号」)
- 「搜 RAG」 → `supsub search "RAG"`
- 「想订阅"机器之心"公众号」 → `supsub mp search "机器之心"` 拿 `mpId` → `supsub sub add --mp-id <mpId>`

> Prefer the installed binary `supsub <args>` (from `@supsub/cli`); fall back to `pnpm dev -- <args>` only when iterating on uncommitted source changes.

---

The sections below describe how to *develop* this CLI, not how to use it. If your task is implementation/refactor/debug, read on.

## Runtime & package manager

- Runtime is **Bun** (not Node.js). The shebang in `src/index.ts` is `#!/usr/bin/env bun`. Use `bun` APIs freely; `package.json#engines.node` is informational only.
- Package manager is **pnpm** (>= 10). Never use `npm` or `yarn` — `.npmrc` sets `auto-install-peers=true` and `strict-peer-dependencies=false`.

## Commands

- `pnpm dev -- <args>` — run the CLI from source (`bun run src/index.ts`). Use this for local CLI testing, not the compiled binary.
- `pnpm build` — `bun build --compile` to a single executable at `dist/supsub`.
- `pnpm typecheck` — `tsc --noEmit`. Run after non-trivial type changes; build does not typecheck.
- `pnpm test` — `bun test` runs the **entire** suite, including `test/e2e/` which hits the live `https://supsub.net` API and requires real credentials. To skip e2e, target dirs explicitly: `bun test test/commands test/config test/http`.

## TypeScript config to respect

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true` — array/record access returns `T | undefined`; narrow before use.
- `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- Module target is ESNext with bundler resolution; no transpilation step besides `bun build`.

## Architectural rules

These conventions are enforced by the existing structure — new code must follow them or the abstractions break:

- **All HTTP goes through `src/http/client.ts`'s `request()`.** It handles auth header injection, error envelope normalization, and exit-code mapping. Do not call `fetch` directly from commands or `src/api/`.
- **Credential resolution lives in `src/http/credentials.ts`** with strict precedence: `--api-key` flag > `SUPSUB_API_KEY` env > `api_key` in config > `bearer_token` (transient browser session). A 401 response clears stored auth.
- **All command output goes through `src/ui/output.ts`'s `output()`.** It dispatches between JSON mode (`-o json`, errors to stdout for jq piping) and table mode (errors to stderr). Never `console.log` results directly.
- **Errors are `ErrorEnvelope` objects** (`src/lib/errors.ts`) with semantic exit codes from `src/lib/exit-code.ts`: `0` OK, `2` UNAUTHORIZED, `3` PLAN_EXPIRED, `10` NETWORK, `11` SERVER, `64` INVALID_ARGS. Callers may rely on these — do not change the mapping casually.
- **Commands follow the `register<Name>(parent: Command)` pattern** — see existing files in `src/commands/` for the shape.

## API base URL

Defaults to `https://supsub.net`. Override with the `--api-url` global flag or the `SUPSUB_API_URL` env var (flag wins; both resolved in `src/lib/api-url.ts` via `getApiUrl()`, with the flag injected through `setCliApiUrl` in the `preAction` hook). Use this for local API server testing.

## Config file

- Default path is `~/.supsub/config.json`. Override the directory with `SUPSUB_CONFIG_DIR` env (file name stays `config.json`); evaluated lazily on every read/write so tests can isolate via `bunfig.toml` preload.
- Directory is mode `0700`, file is mode `0600`. Unix-only; `chmod` is silently skipped on Windows.
- Tests must never write to the user's real `~/.supsub`. The `test/setup.ts` preload (wired in `bunfig.toml`) mktemp's a dir and exports `SUPSUB_CONFIG_DIR` for the whole `bun test` run; new tests should resolve paths via `test/_helpers/config-path.ts`, never via `os.homedir()`.

## Conventions

- **Comments and user-facing strings are in Chinese.** New code should match — don't switch to English mid-file.
- Implementation note: the `mp search` command (used only for the narrow 公众号-discovery flow above) is async — it polls for ~30s then returns a `searchId` for follow-up via `mp search-cancel <searchId>`. See `skills/supsub-mp/SKILL.md` for full behavior.

## 发布流程

> **⚠️ 强制门禁：发版前必须与用户二次确认版本号。** 收到「发版 / 发布 / release / 出个新版本」类请求时，**先**根据改动给出建议版本号（语义化版本：bugfix/文档 → patch，向后兼容的新功能 → minor，破坏性变更 → major）并**明确询问用户确认**。**只有用户确认版本号之后**，才可以进入下面的正式发布流程。未确认前不要 bump 版本、不要 commit、不要打 tag、不要推送。

确认版本号后，按惯例执行：

1. **bump 版本号** —— 更新 `package.json#version` 到确认的 `X.Y.Z`。
2. **`chore(release)` commit** —— 提交信息形如 `chore(release): vX.Y.Z`。
3. **打 tag** —— `git tag vX.Y.Z`（tag 名带 `v` 前缀）。
4. **推 tag 触发 CI** —— `git push --tags`。`.github/workflows/release.yml` 由 `v*` tag 触发，自动构建多平台 binary（darwin/linux/windows × amd64/arm64）、创建 GitHub Release、并以 OIDC trusted publishing 发布到 npm（`@supsub/cli`）。CI 会在版本不一致时自行 `npm version` 对齐，无需手动改 npm 上的版本。
