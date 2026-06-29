# SupSub CLI 终端功能清单

> 本文档罗列 `supsub` 在终端中**当前已实现、可直接使用**的全部功能：命令、参数、行为与终端层面的约定（输出格式、退出码、环境变量）。
> 仅描述「能用什么」；底层授权时序见 [`cli-auth-flow.md`](./cli-auth-flow.md)。

---

## 全局用法

```
supsub [全局选项] <命令> [子命令] [参数]
```

| 全局选项 | 说明 | 默认 |
|---|---|---|
| `-o, --output <table\|json>` | 输出格式 | `table` |
| `--api-key <key>` | 指定 API Key（优先级高于环境变量与配置文件） | 无 |
| `--api-url <url>` | 指定 API 基地址（优先级高于 `SUPSUB_API_URL` 环境变量） | `https://supsub.net` |
| `-V, --version` | 打印版本号 | — |
| `-h, --help` | 打印帮助（每个子命令也支持） | — |

---

## 1. 认证 `auth`

| 命令 | 功能 |
|---|---|
| `supsub auth login` | 登录。默认走浏览器 OAuth 设备授权（Device Flow），自动打开浏览器并轮询授权状态；成功后拉取并展示当前用户「昵称 + 邮箱」 |
| `supsub auth login --api-key <key>` | 用 API Key 直接登录，跳过浏览器授权；同样展示「昵称 + 邮箱」 |
| `supsub auth status` | 查看当前登录状态：邮箱、昵称、client_id、脱敏密钥、凭证来源、套餐是否过期 |
| `supsub auth logout` | 登出，清除本地保存的凭证 |

> `auth login` 在无头/CI 环境可设 `SUPSUB_NO_BROWSER=1` 禁止自动打开浏览器。
> 登录成功后形如 `👤 爱丽丝 <alice@example.com>` 的用户信息走 stderr 输出；`-o json` 模式下 `email` / `name` 一并出现在 stdout 的 `data` 中。

---

## 2. 订阅源 `sub`

### `supsub sub list` — 列出订阅源

| 选项 | 说明 |
|---|---|
| `--type <MP\|WEBSITE>` | 按类型过滤（可选） |

输出列：`sourceId`、`类型`、`name`、`description`，末尾显示总条数。

### `supsub sub add` — 添加订阅

`--source-id` 与 `--mp-id` **二选一、互斥**。

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 内部信息源 ID（正整数，来自 `search` / `sub list`）；**必须配合 `--type`** |
| `--mp-id <mpId>` | 公众号 mpId（base64，来自 `mp search`）；`--type` 可省，默认 `MP` |
| `--type <MP\|WEBSITE>` | 信息源类型 |
| `--group <gid>` | 分组 ID，可重复指定以加入多个分组 |

### `supsub sub remove` — 取消订阅

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 必填 |
| `--type <MP\|WEBSITE>` | 必填 |

### `supsub sub contents` — 查看订阅源内文章

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 必填 |
| `--type <MP\|WEBSITE>` | 必填 |
| `--unread` | 仅未读（默认） |
| `--all` | 全部文章（与 `--unread` 互斥） |

输出列：`publishedAt`（`YYYY-MM-DD HH:mm`）、`read`（已读为 `✓`）、`title`、`articleId`、`url`。

---

## 3. 搜索 `search`

### `supsub search <keyword>` — 全站搜索（源 + 文章）

| 选项 | 说明 | 默认 |
|---|---|---|
| `--type <ALL\|MP\|WEBSITE\|CONTENT>` | 搜索范围：全部 / 公众号 / 网站 / 文章正文 | `ALL` |

输出同时包含「源」与「文章」两类结果，每条带类型、ID、名称/标题、域名、摘要。

---

## 4. 公众号 `mp`

| 命令 | 功能 |
|---|---|
| `supsub mp search <name>` | 搜索公众号。后台异步任务，CLI 每 2 秒轮询、最长 30 秒，自动累积去重候选结果（含 `mpId` / 名称 / 描述）。`mpId` 可直接用于 `sub add --mp-id` |
| `supsub mp search-cancel <searchId>` | 取消正在执行的公众号搜索任务 |

---

## 5. 自更新 `update` 与 Skills 同步 `skills`

| 命令 | 功能 |
|---|---|
| `supsub update` | 检查并更新到最新版本：查 npm registry 最新版 → 从 GitHub Release 下载对应平台预编译 binary → 原地替换正在运行的可执行文件，并顺带同步本地 skills |
| `supsub update --check` | 只检查是否有新版本，输出 `current` / `latest` / `hasUpdate`，不实际更新（不动 skills） |
| `supsub update --force` | 即使已是最新也重新下载安装（修复损坏的 binary），并重新同步 skills |
| `supsub update --skip-skills` | 本次更新不同步本地 skills |

二进制自更新机制说明：

- 替换采用「同目录暂存 + 原子 `rename`」覆盖自身，Unix 下可覆盖正在运行的可执行文件，更新后下次运行即新版本。
- 下载资产命名与 `scripts/postinstall.cjs` 完全一致（同一套 GitHub Release 包），二者是两条等价的更新路径。
- 若全局安装目录无写权限（如装在需 sudo 的路径），会以退出码 `1` 报错并提示改用 `npm i -g @supsub/cli@latest` 或加 `sudo` 重试。
- 不读取/不发送任何凭证，访问的是 `registry.npmjs.org` 与 `github.com`，与 supsub API 鉴权无关。

> 除 `supsub update` 外，也可随时用包管理器手动更新：`npm i -g @supsub/cli@latest`（会触发 postinstall 重新下载 binary）。CLI 本身不做后台自动更新，也不在启动时检查新版本。

### Skills 同步 `skills`

| 命令 | 功能 |
|---|---|
| `supsub skills sync` | 用 `npx skills add` 把本仓库 skills 同步到本地 agent 配置，**默认仅装到当前项目** `./.agents/skills`，成功后记录同步版本 |
| `supsub skills sync --global` | 改装到全局 `~/.claude/skills`（对所有项目可见；全局侵入性强，需显式指定） |
| `supsub skills sync --force` | 即使本地已是当前版本也重新同步 |
| `supsub skills status` | 查看本地 skills 版本 vs 当前 CLI 版本、是否漂移 |
| `supsub skills list` | 列出本仓库提供的 skills |

skills 同步机制说明：

- CLI 自更新只换二进制，本地 skills 装在 `~/.claude/skills` 不会自动跟着升级。`~/.supsub/skills-state.json` 记录「上次同步到的 CLI 版本」。
- 每次运行任意命令前，做一次零网络的本地比对：本地 skills 落后于当前二进制时，在 stderr 提示运行 `supsub skills sync`（`skills` / `update` / `--help` 等命令不重复打扰）。
- 冷启动（从未通过 supsub 同步过）、CI、`SUPSUB_NO_SKILLS_NOTIFIER` 真值时不提示。
- 完整流程图见 [`self-update-flow.md`](./self-update-flow.md)。

---

## 6. 输出格式

- **`table`（默认）**：彩色表格，表头青色加粗；对中文/全角字符按 2 列宽度对齐，避免列错位。
- **`-o json`**：向 stdout 输出 `{ "success": true, "data": ... }`，可直接 `jq` 处理。出错时输出 `{ "success": false, "error": {...} }`（同样在 stdout）。
- 成功提示（`✅ 登录成功`、`已登出` 等）走 stderr，因此两种模式下 stdout 都只承载数据。
- **Loading 动画**：发请求 / 轮询等耗时操作期间会在 stderr 显示一个 spinner（如「加载订阅列表…」「搜索公众号「X」中…」「等待浏览器授权中…」），避免黑屏。仅在交互式终端（TTY）下渲染；管道 / 重定向 / CI / 非 TTY 环境自动静默，绝不污染 stdout（`-o json` 与表格数据始终纯净）。可用 `SUPSUB_NO_SPINNER=1` 强制关闭。

---

## 7. 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 一般业务错误 |
| `2` | 未登录 / 鉴权失败 |
| `3` | 套餐已过期 |
| `10` | 网络错误 |
| `11` | 服务端错误 |
| `64` | 参数非法 |

可在脚本中据此判断结果，例如配合 `-o json` 做自动化。

---

## 8. 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `SUPSUB_API_KEY` | 注入 API Key（等价于 `--api-key`，但 flag 优先级更高） | 无 |
| `SUPSUB_API_URL` | 覆盖 API 基址（等价于 `--api-url`，但 flag 优先级更高） | `https://supsub.net` |
| `SUPSUB_NO_BROWSER` | 真值时 `auth login` 不自动打开浏览器 | 未设 |
| `SUPSUB_NO_SPINNER` | 真值时关闭所有 loading 动画（非 TTY 下本就不渲染） | 未设 |
| `SUPSUB_NO_SKILLS_NOTIFIER` | 真值时关闭「本地 skills 落后」的启动提示 | 未设 |
| `SUPSUB_CONFIG_DIR` | 覆盖配置目录（凭证存于 `<dir>/config.json`，状态存于 `<dir>/skills-state.json`） | `~/.supsub` |

---

## 9. 凭证存储与优先级

凭证保存在 `~/.supsub/config.json`（目录 `0700` / 文件 `0600`）。每次请求按以下优先级取凭证：

1. `--api-key` 命令行参数
2. `SUPSUB_API_KEY` 环境变量
3. 配置文件中的设备流令牌 / API Key
4. 配置文件中手动粘贴的浏览器会话 token

任意请求返回 401 会自动清除本地凭证，需重新 `auth login`。
