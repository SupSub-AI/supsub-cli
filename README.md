# SupSub CLI

[![npm version](https://img.shields.io/npm/v/@supsub/cli.svg)](https://www.npmjs.com/package/@supsub/cli)
[![npm downloads](https://img.shields.io/npm/dm/@supsub/cli.svg)](https://www.npmjs.com/package/@supsub/cli)
[![license](https://img.shields.io/npm/l/@supsub/cli.svg)](https://github.com/SupSub-AI/supsub-cli/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/@supsub/cli.svg)](https://www.npmjs.com/package/@supsub/cli)

[SupSub](https://supsub.net) 的命令行工具，让你在终端里直接管理订阅源、搜索内容、追踪公众号、网站。

📖 **[完整文档站](https://supsub-ai.github.io/supsub-cli/)** —— [快速上手](https://supsub-ai.github.io/supsub-cli/guide/getting-started) · [核心概念](https://supsub-ai.github.io/supsub-cli/guide/concepts) · [命令参考](https://supsub-ai.github.io/supsub-cli/reference/) · [Agent 集成](https://supsub-ai.github.io/supsub-cli/agents/)

---

## 安装

**方式一：native 安装（推荐，macOS / Linux）**

```bash
curl -fsSL https://raw.githubusercontent.com/SupSub-AI/supsub-cli/master/scripts/install.sh | bash
```

装到用户目录 `~/.local`（永不需要 sudo），版本并存可回滚，并支持**后台静默自动更新**。安装后若提示 `~/.local/bin` 不在 `PATH`，按提示把它加入 shell 配置即可。

**方式二：npm（跨平台，含 Windows）**

```bash
npm i -g @supsub/cli
```

支持 macOS / Linux / Windows（x64 / arm64）。npm 安装为手动更新（`supsub update` 或 `npm i -g @supsub/cli@latest`），不做后台自动更新。

**方式三：让 AI 助手替你装**——把下面这句发给 Claude Code / Cursor 等助手，安装、技能包、登录一步到位：

> 请阅读 https://raw.githubusercontent.com/SupSub-AI/supsub-cli/master/docs/cli-installation-guide.md 并据此帮我安装并配置 SupSub CLI

---

## 三步开始用

**第一步：安装**（如上）

**第二步：登录**
```bash
supsub auth login
```
会自动打开浏览器走 OAuth 设备授权流程完成登录。

**第三步：开始用**
```bash
# 看看自己的订阅源
supsub sub list

# 搜一个公众号订上
supsub mp search "阮一峰"

# 搜全站内容
supsub search "RAG"
```

---

## 使用场景

**场景 1：订阅一个公众号**
```bash
# 先搜公众号，拿到 mpId（base64 字符串，例如 MzkyNTYzODk0NQ==）
supsub mp search "阮一峰的网络日志"

# 用 --mp-id 添加订阅（不需要 --type，默认 MP）
supsub sub add --mp-id "MzkyNTYzODk0NQ=="

# 之后想看这个公众号的未读文章，从 sub list 拿到内部 sourceId 即可
supsub sub list --type MP
supsub sub contents --source-id 12345 --type MP
```

**场景 2：搜索内容**
```bash
# 全量搜索（源 + 文章）
supsub search "AI"

# 仅搜公众号
supsub search "Agent" --type MP

# 仅搜文章正文
supsub search "Claude" --type CONTENT
```

**场景 3：管理订阅**
```bash
# 列出所有订阅源
supsub sub list

# 仅看已订阅的网站
supsub sub list --type WEBSITE

# 取消订阅
supsub sub remove --source-id 12345 --type MP
```

---

## 完整命令参考

### 认证

```
supsub auth login                   OAuth 登录（浏览器授权）
supsub auth status                  查看当前登录状态
supsub auth logout                  退出登录（清除本地凭证）
```

### 订阅源

```
supsub sub list                     列出全部订阅源
  --type <MP|WEBSITE>               按类型过滤

supsub sub add                      添加订阅（--source-id 与 --mp-id 二选一）
  --source-id <id>                  内部信息源 ID（正整数，来自 search / sub list）
  --mp-id <mpId>                    公众号 mpId（base64，来自 mp search）
  --type <MP|WEBSITE>               --source-id 模式必填；--mp-id 模式可省，默认 MP
  --group <gid>                     分组 ID（可重复指定）

supsub sub remove                   取消订阅
  --source-id <id>                  必填
  --type <MP|WEBSITE>               必填

supsub sub contents                 查看订阅源内的文章
  --source-id <id>                  必填
  --type <MP|WEBSITE>               必填
  --unread                          仅未读（默认）
  --all                             全部文章（与 --unread 互斥）
  --page <n>                        页码（默认 1）
  --page-size <n>                   每页条数 1-100（默认 20）

supsub sub mark-read                整源标记已读（不可逆，无取消已读命令）
  --source-id <id>                  必填
  --type <MP|WEBSITE>               必填
  --all                             必填，确认整源全部已读（不支持单篇已读）
```

### 关注点

```
supsub focus list                   列出关注点（含 unreadCount）
supsub focus contents               查看关注点内容
  --id <focusId>                    必填
  --unread / --all                  未读（默认）/ 全部，互斥
  --page <n> / --page-size <n>      翻页（默认 1 / 20，page-size 上限 100）

supsub focus mark-read              整个关注点标记已读（不可逆）
  --id <focusId>                    必填
  --all                             必填，确认全部已读（不支持单篇已读）

supsub focus remove --id <focusId>  删除关注点（不可逆，CLI 无新增能力）
```

### 订阅分组

```
supsub group list                   列出分组
supsub group add <name>             创建分组（返回新分组 id）
supsub group rename                 重命名分组
  --id <gid> --name <newName>       均必填

supsub group remove --id <gid>      删除分组（不可逆；组内订阅源不受影响）

supsub group subs                   查看分组订阅源
  --id <gid>                        必填
  --all                             显示全部源（带 inGroup 列；不带则仅组内成员 + unreadCount）
  --type <MP|WEBSITE|X|PODCAST|NEWSLETTER>  按类型过滤

supsub group add-sub                把订阅源加入分组（幂等）
supsub group remove-sub             把订阅源移出分组（幂等，不会退订）
  --id <gid> --source-id <sid> --type <MP|WEBSITE|X>   均必填
```

> 分组成员编辑是整体覆盖语义，请勿并发编辑同一分组（包括同时在网页端编辑同一分组）。

### 未读概览

```
supsub unread                       订阅源 + 关注点的未读概览（默认只显示有未读的）
  --all                             含无未读的项
```

### 搜索

```
supsub search <keyword>             全量搜索（订阅源 + 文章）
  --type <ALL|MP|WEBSITE|CONTENT>   搜索范围，默认 ALL
```

### 精读

```
supsub deepread run                 对单篇文章做 AI 深度拆解（默认前台等待完成，通常需要几十秒）
  --type <MP|WEBSITE|X>             信息源类型
  --content-id <cid>                内容 ID（来自 sub contents / focus contents / search）
  --title / --source-name / --url   写入本地队列的展示信息（建议总是带上）
  --no-wait                         只发起不等待（批量排队时用）
  --timeout <sec>                   等待上限，默认 180
  --brief                           精简输出，省略正文部分
supsub deepread get                 查看精读结果（优先本地缓存，--refresh 强制回源，--out 导出 Markdown）
supsub deepread list                本地精读队列（--wait 等全部落定，--all 看全部历史）
supsub deepread quota               本月精读额度余额
supsub deepread share               生成分享链接（公开可访问、暂不可撤销）
supsub deepread show --share-code   查看他人分享的精读（无需登录）
supsub deepread drop                从本地队列移除（不影响服务端结果）
```

> **精读按次消耗月度额度**，且没有退额度的操作 —— agent 集成务必在发起前
> 先 `deepread quota` 查询余额并与用户确认。已精读过的文章重复 `run` 不会重复扣费。
>
> 每篇精读会在 `~/.supsub/deepread/` 下保存本地副本（含可直接阅读的 Markdown）；
> 队列是**本机本地**的，与网页端的「稍后阅读」互不可见。

### 公众号

```
supsub mp search <name>             搜索公众号（异步，自动等待最长约 30s）
supsub mp search-cancel <searchId>  取消正在执行的搜索任务
```

### 自更新

```
supsub update                       检查并更新到最新版本（并同步本地 skills）
  --check                           只检查是否有新版本，不实际更新
  --force                           即使已是最新也重新下载安装（修复损坏的 binary）
  --skip-skills                     本次更新不同步本地 skills
  --rollback                        回滚到上一个留存版本（仅 native 安装，重指 symlink，不重新下载）
```

> **native 安装**：下载新版本到 `~/.local/share/supsub/versions/<版本>/` 并原子切换 symlink，
> 旧版本保留最近 3 个可回滚（`supsub update --rollback`）。装在用户目录，永不需要 sudo。
>
> **npm 安装**：下载新 binary 原地替换。若全局目录无写权限（需 sudo 的路径），会提示改用
> `npm i -g @supsub/cli@latest` 或加 `sudo` 重试。
>
> **manual（手装）安装**：`supsub doctor` 报 `manual` 的独立二进制（多为 0.4.0 之前
> `curl … | bash` 装下的普通文件）。若它正好位于 native 的 symlink 位（默认 `~/.local/bin/supsub`），
> 只需跑一次 `supsub update` 就会**自动迁移到 native 布局**（下载到 `versions/` 后用 symlink 原子
> 替换那个普通文件），**即使当前已是最新版本也会迁移，无需 `--force`**——一次收敛，此后即拥有
> 版本并存、回滚与后台自动更新。此时输出会如实说明「已是最新，且已迁移到 native 布局」。手动
> cp 到别处（如 `/usr/local/bin`）的独立二进制则维持原地覆盖，不迁移。
>
> 更新完成后会顺带把本地 Agent Skills 同步到新版本（best-effort，失败只警告不阻断）。
> 详见下方 [Skills（AI agent 集成）](#skillsai-agent-集成)。

**后台自动更新（仅 native 安装）**：native 安装会在后台静默检查并升级，新版本**下次启动才生效**，
不打断当前命令。`-o json` / CI 环境下**永不**自动更新（那正是 agent / 脚本在跑）。设
`SUPSUB_DISABLE_AUTOUPDATER=1` 可完全关闭后台检查（`supsub update` 手动更新仍可用）。
可在 `~/.supsub/config.json` 配置 `autoUpdateChannel`（`latest` 默认 / `stable` 只自动升 patch）
与 `minimumVersion`（自动更新不会低于此版本）。

### 自检

```
supsub doctor                       安装 / 更新自检：当前版本与真实路径、安装方式（native / npm / manual / dev）、
                                    symlink 指向、留存版本、上次更新检查时间与结果、~/.local/bin 是否在 PATH、skills 同步状态
```

### Skills 同步

```
supsub skills sync                  把本仓库的 skills 同步/更新到本地 agent 配置
  --project                         装到当前项目（./.agents/skills），默认装到全局（~/.claude/skills）
  --force                           即使本地已是当前版本也重新同步
supsub skills status                查看本地 skills 版本 vs 当前 CLI 版本、是否漂移
supsub skills list                  列出本仓库提供的 skills
```

> CLI 自更新只换二进制，本地 skills 不会自动跟着升级。一旦检测到本地 skills 落后于
> 当前版本，就在 stderr 提示运行 `supsub skills sync`。设 `SUPSUB_NO_SKILLS_NOTIFIER=1` 可关闭该提示。

---

## 全局参数

| 参数 | 说明 |
|------|------|
| `--api-url <url>` | 指定 API 基地址，默认 `https://supsub.net` |
| `-o, --output table\|json` | 输出格式，默认 `table` |

## 环境变量

| 变量 | 说明 |
|------|------|
| `SUPSUB_API_URL` | API 基地址（同 `--api-url`，命令行 flag 优先级更高） |
| `SUPSUB_WEB_URL` | Web 站点基地址，用于拼精读分享链接 `/s/<code>`；未设时跟随 API 基址 |
| `SUPSUB_NO_BROWSER` | 设为真值时 `auth login` 不自动打开浏览器（无头 / e2e 环境用） |
| `SUPSUB_NO_SPINNER` | 设为真值时关闭所有 loading 动画（非 TTY 下本就不渲染） |
| `SUPSUB_NO_SKILLS_NOTIFIER` | 设为真值时关闭「本地 skills 落后」的启动提示 |
| `SUPSUB_CONFIG_DIR` | 覆盖配置 / 状态文件目录（默认 `~/.supsub`） |
| `SUPSUB_DISABLE_AUTOUPDATER` | 设为真值时关闭 native 安装的后台自动更新（手动 `supsub update` 仍可用） |
| `SUPSUB_DATA_DIR` | 覆盖 native 安装的版本并存根目录（默认 `~/.local/share/supsub`） |
| `SUPSUB_BIN_DIR` | 覆盖 native 安装的 symlink 目录（默认 `~/.local/bin`） |
---

## Skills（AI agent 集成）

`skills/` 遵循 [Agent Skills 规范](https://agentskills.io)，可在 Claude Code、Cursor、Gemini CLI、Codex、Copilot 等兼容 agent 中使用。

| Skill | 覆盖命令 |
|-------|----------|
| supsub-auth | `auth login` / `auth status` / `auth logout` |
| supsub-sub | `sub list` / `sub add` / `sub remove` / `sub contents` / `sub mark-read` |
| supsub-search | `search <keyword>` |
| supsub-mp | `mp search` / `mp search-cancel` |
| supsub-deepread | `deepread run` / `get` / `list` / `quota` / `share` / `drop` / `show` |
| supsub-focus | `focus list` / `focus contents` / `focus mark-read` / `focus remove` |
| supsub-group | `group list` / `add` / `rename` / `remove` / `subs` / `add-sub` / `remove-sub` |
| supsub-unread | `unread` + 未读工作流（钻取未读列表 → `sub` / `focus mark-read --all` 整体已读） |

### 安装

Claude Code（推荐）：

```shell
/plugin marketplace add SupSub-AI/supsub-cli
/plugin install supsub-cli@supsub
```

或装好 CLI 后用 supsub 自带的同步命令（装到全局 `~/.claude/skills`，并登记同步版本）：

```shell
supsub skills sync
```

其他 agent，用 [`skills` CLI](https://github.com/vercel-labs/skills)：

```bash
# 静默安装仓库内全部 skills 到当前项目（--skill '*' 选全部，-y 跳过确认；项目级，落在 ./.agents/skills/）
npx -y skills add SupSub-AI/supsub-cli --skill '*' -y
```

> 升级后想让本地 skills 跟上：`supsub update` 会自动同步，或随时手动 `supsub skills sync`；
> `supsub skills status` 可查看本地 skills 是否与当前 CLI 版本一致。

### 使用

装完后直接用自然语言即可，agent 会自动调用对应的 skill：

> 帮我订阅「阮一峰的网络日志」这个公众号

> 搜一下最近关于 RAG 的文章，挑 3 条给我

---

## License

MIT
