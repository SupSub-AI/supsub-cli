# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **READ THIS FIRST if you are answering an end-user natural-language SupSub request.**
> Many requests will look like "搜一下 X" / "查一下 X" — they are **not** about microblog accounts by default. Consult the routing table immediately below before doing anything else; do not skim source code in `src/commands/` to guess the command.

## End-user 意图 → 命令路由（最高优先级）

This section is the authoritative routing table for **end-user-style natural-language requests** about SupSub usage (登录 / 订阅 / 搜索 / 找公众号 …). The same mapping is encoded in `skills/*/SKILL.md`; this section exists so agents that don't pick up the marketplace skills (e.g. sub-agents inheriting CWD inside this repo) still route correctly. **Match the user's intent against this table first; only then look at command source if you need flag-level detail.**

| 用户意图 (中文) | Skill | 命令 |
|---|---|---|
| 登录 / 登出 / 查看登录状态 / 我现在用哪个账号 | `supsub-auth` | `supsub auth login` / `logout` / `status` |
| 列出订阅 / 我订阅了哪些 / 添加订阅 / 取消订阅 / 看某个订阅里有哪些文章 | `supsub-sub` | `supsub sub list` / `add` / `remove` / `contents`（订阅源类型 `MP`公众号 / `WEBSITE`网站 / `X`推特） |
| 我的关注点 / 关注点列表 / 看某个关注点里的内容（文章）/ 关注点有哪些未读 / 删除关注点 | `supsub-focus` | `supsub focus list` / `contents` / `remove`（**无新增**；删除不可逆） |
| **搜文章 / 搜内容 / 关键词找文章 / 全文搜 / 「搜一下 X」 / 「搜 X 相关的内容」** | `supsub-search` | `supsub search <kw> [--type ALL\|MP\|WEBSITE\|CONTENT]` |
| **发现一个具体公众号账号 / 「找 XXX 这个公众号」 / 想订阅某公众号但不知道 ID** | `supsub-mp` | `supsub mp search <name>` → 拿 `mpId` → `supsub sub add --mp-id <mpId>` |

> **订阅源（sub）vs 关注点（focus）** —— 二者都是「我在追的东西」，但不同：**订阅源**是具体的一个号（公众号 / 网站 / 推特账号），按 `sourceId`+`sourceType` 操作；**关注点**是用户自定义的主题/关注方向（带 AI 聚合，列表项形如 `{id, icon, title}`，如「Agent 行业落地」），按 `focus id` 操作。「我订阅了哪些 / 取消订阅某个号」→ `supsub-sub`；「我的关注点 / 这个关注点里有什么」→ `supsub-focus`。裸动词「我关注了哪些（号 / 公众号）」**默认按订阅理解 → `supsub-sub`**；只有出现「关注点」三字才走 `supsub-focus`。
>
> **⚠️ 字母「X」的两种含义** —— 路由示例里用「X」「XXX」当**占位符**代指用户的真实词/账号名（如「搜 X」「找 XXX 这个公众号」），它**不是**类型；而 `sub --type X` 里的 `X` 是真实 sourceType，专指**推特/Twitter 平台账号**（后端只认 `X`，不认 `TWITTER`）。只有用户**明确提到推特/Twitter/X 平台**时才用 `--type X`；「订阅 X」「X 公众号」这类占位用法不要推断成 `--type X`。

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
