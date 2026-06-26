# SupSub CLI

[![npm version](https://img.shields.io/npm/v/@supsub/cli.svg)](https://www.npmjs.com/package/@supsub/cli)
[![npm downloads](https://img.shields.io/npm/dm/@supsub/cli.svg)](https://www.npmjs.com/package/@supsub/cli)
[![license](https://img.shields.io/npm/l/@supsub/cli.svg)](https://github.com/SupSub-AI/supsub-cli/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/@supsub/cli.svg)](https://www.npmjs.com/package/@supsub/cli)

[SupSub](https://supsub.net) 的命令行工具，让你在终端里直接管理订阅源、搜索内容、追踪公众号、网站。

---

## 安装

```bash
npm i -g @supsub/cli
```

支持 macOS / Linux / Windows（x64 / arm64）。

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
```

### 搜索

```
supsub search <keyword>             全量搜索（订阅源 + 文章）
  --type <ALL|MP|WEBSITE|CONTENT>   搜索范围，默认 ALL
```

### 公众号

```
supsub mp search <name>             搜索公众号（异步，自动轮询 30s）
supsub mp search-cancel <searchId>  取消正在执行的搜索任务
```

### 自更新

```
supsub update                       检查并更新到最新版本（下载新 binary 原地替换）
  --check                           只检查是否有新版本，不实际更新
  --force                           即使已是最新也重新下载安装（修复损坏的 binary）
```

> 自更新从 npm registry 查最新版本，再从 GitHub Release 下载对应平台的预编译 binary、
> 原地替换正在运行的可执行文件。若全局安装目录无写权限（如装在需 sudo 的路径），
> 会提示改用 `npm i -g @supsub/cli@latest` 或加 `sudo` 重试。

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
| `SUPSUB_NO_BROWSER` | 设为真值时 `auth login` 不自动打开浏览器（无头 / e2e 环境用） |
| `SUPSUB_NO_SPINNER` | 设为真值时关闭所有 loading 动画（非 TTY 下本就不渲染） |
---

## Skills（AI agent 集成）

`skills/` 遵循 [Agent Skills 规范](https://agentskills.io)，可在 Claude Code、Cursor、Gemini CLI、Codex、Copilot 等兼容 agent 中使用。

| Skill | 覆盖命令 |
|-------|----------|
| supsub-auth | `auth login` / `auth status` / `auth logout` |
| supsub-sub | `sub list` / `sub add` / `sub remove` / `sub contents` |
| supsub-search | `search <keyword>` |
| supsub-mp | `mp search` / `mp search-cancel` |

### 安装

Claude Code（推荐）：

```shell
/plugin marketplace add SupSub-AI/supsub-cli
/plugin install supsub-cli@supsub
```

其他 agent，用 [`skills` CLI](https://github.com/vercel-labs/skills)：

```bash
# 静默安装仓库内全部 skills（--skill '*' 选全部，-y 跳过确认）
npx -y skills add SupSub-AI/supsub-cli --skill '*' -y
```

### 使用

装完后直接用自然语言即可，agent 会自动调用对应的 skill：

> 帮我订阅「阮一峰的网络日志」这个公众号

> 搜一下最近关于 RAG 的文章，挑 3 条给我

---

## License

MIT
