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

> **信息源类型 `--type`** 全 CLI 统一取值 `MP`（公众号）/ `WEBSITE`（网站）/ `X`（推特，后端只认 `X`，不认 `TWITTER`），大小写不敏感。表格里的「类型」列渲染为中文（公众号 / 网站 / 推特；分组成员还可能出现网页端加入的播客 / 通讯）。

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

订阅源 = 一个具体的号（公众号 / 网站 / 推特账号），按 `sourceId` + `sourceType` 定位。

### `supsub sub list` — 列出订阅源

| 选项 | 说明 |
|---|---|
| `--type <MP\|WEBSITE\|X>` | 按类型过滤（可选） |

输出列：`sourceId`、`类型`、`name`、`description`，末尾显示总条数。`-o json` 的每项还带 `unreadCount`（未读数）。

### `supsub sub add` — 添加订阅

`--source-id` 与 `--mp-id` **二选一、互斥**。

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 内部信息源 ID（正整数，来自 `search` / `sub list`）；**必须配合 `--type`** |
| `--mp-id <mpId>` | 公众号 mpId（base64，来自 `mp search`）；`--type` 可省，默认 `MP` |
| `--type <MP\|WEBSITE\|X>` | 信息源类型 |
| `--group <gid>` | 分组 ID，可重复指定以加入多个分组 |

> `--source-id` 与 `--mp-id` 是两个不同的 ID 空间，不可互换：前者是站内正整数，后者是微信原生 base64 串。

### `supsub sub remove` — 取消订阅

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 必填 |
| `--type <MP\|WEBSITE\|X>` | 必填 |

### `supsub sub contents` — 查看订阅源内文章

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 必填（别名 `--id`，与 `focus contents --id` 写法对齐） |
| `--type <MP\|WEBSITE\|X>` | 必填 |
| `--unread` | 仅未读（默认） |
| `--all` | 全部文章（与 `--unread` 互斥） |
| `--brief` | 精简输出：只留 `contentId` / `title` / 发布时间 / 已读状态 |
| `--page <n>` | 页码（默认 `1`） |
| `--page-size <n>` | 每页条数 `1`-`100`（默认 `20`） |

输出列：`publishedAt`（`YYYY-MM-DD HH:mm`）、`read`（已读为 `✓`）、`title`、`contentId`、`url`；`--brief` 时去掉 `url` 列。

> 默认只返回**未读**。要按时间浏览「最近有什么」需显式加 `--all`，否则该源读完后会返回空列表。

### `supsub sub mark-read` — 整源标记已读

| 选项 | 说明 |
|---|---|
| `--source-id <id>` | 必填 |
| `--type <MP\|WEBSITE\|X>` | 必填 |
| `--all` | **必填**，确认把该源全部内容标为已读 |

> **只有「整源已读」一档，没有单篇已读。** 文章在 SupSub 里没有「详情 / 阅读」这一步，产生不了自然的单篇已读事件，因此 CLI 只保留用户明确表达的「这个号我读完了」。传 `--content-id` 会以退出码 `64` 报错并说明原因。
>
> **`--all` 必填且不可逆**：后端没有 mark-as-unread，标错无法恢复。要求显式给出 `--all`，是为了让「清空一个源」始终是一次明确动作而非误触。

---

## 3. 关注点 `focus`

关注点 = 用户自定义的主题方向（带 AI 聚合，跨多个来源），按 `focus id` 定位。**CLI 无新增关注点能力**（在网页端创建）。

### `supsub focus list` — 列出关注点

无选项。输出列：`id`、`icon`、`title`、`unreadCount`。

### `supsub focus contents` — 查看关注点内容

| 选项 | 说明 |
|---|---|
| `--id <focusId>` | 必填 |
| `--unread` | 仅未读（默认） |
| `--all` | 全部内容（与 `--unread` 互斥） |
| `--brief` | 精简输出：只留 `contentId` / `title` / 来源 / 发布时间 / 已读状态 |
| `--page <n>` | 页码（默认 `1`） |
| `--page-size <n>` | 每页条数 `1`-`100`（默认 `20`） |

输出列：`publishedAt`、`read`、`title`、`sourceType`、`sourceName`、`contentId`、`url`；`--brief` 时为 `publishedAt`、`read`、`title`、`sourceName`、`contentId`。

> 同 `sub contents`：默认只返回未读，按时间浏览要加 `--all`。

### `supsub focus mark-read` — 整个关注点标记已读

| 选项 | 说明 |
|---|---|
| `--id <focusId>` | 必填 |
| `--all` | **必填**，确认把整个关注点标为已读 |

> 与 `sub mark-read` 同样的模型：**只有整体已读，没有单篇已读**，`--all` 必填且不可逆。传 `--content-id` / `--type` / `--source-type` 会以退出码 `64` 报错。

### `supsub focus remove` — 删除关注点

| 选项 | 说明 |
|---|---|
| `--id <focusId>` | 必填 |

> **破坏性且不可逆**：CLI 没有新增关注点的命令，删掉只能回网页端重建。

---

## 4. 订阅分组 `group`

分组 = 收纳已订阅源的「文件夹」，成员是**源**而不是文章。

| 命令 | 功能 |
|---|---|
| `supsub group list` | 列出分组，输出列 `id`、`name` |
| `supsub group add <name>` | 创建分组，返回新分组的 `id` / `name` |
| `supsub group rename --id <id> --name <新名称>` | 重命名分组 |
| `supsub group remove --id <id>` | 删除分组（**不可逆**；组内订阅源本身不受影响，只是不再归属该分组） |
| `supsub group subs --id <id> [--all] [--type <t>]` | 查看分组订阅源 |
| `supsub group add-sub --id <id> --source-id <sid> --type <t>` | 把订阅源加入分组 |
| `supsub group remove-sub --id <id> --source-id <sid> --type <t>` | 把订阅源移出分组 |

`group subs` 的两种模式：

- **默认**（仅组内成员）：输出列 `sourceId`、`类型`、`name`、`unreadCount`、`description`。
- **`--all`**（全部订阅源）：输出列 `sourceId`、`类型`、`name`、`inGroup`、`description`——后端在这个模式下**不返回** `unreadCount`，要未读数就用默认模式。
- `--type` 可过滤类型，取值比订阅命令宽：`MP|WEBSITE|X|PODCAST|NEWSLETTER`（分组里可能有网页端加入的播客 / 通讯源）。

> **`add-sub` / `remove-sub` 是「读-改-写全量覆盖」**：后端没有单个成员的原子增删端点，CLI 先拉取当前成员列表、改完再整份写回。因此**不要并发执行**，也不要在网页端同时编辑同一分组，否则后写入的一方会覆盖另一方的改动。
>
> **没有分组级标记已读命令。** 要「清空某个分组」，先 `group subs` 列出成员与各自未读数，确认后逐个执行 `sub mark-read --all`。

---

## 5. 未读概览 `unread`

### `supsub unread` — 一条命令看全未读

| 选项 | 说明 |
|---|---|
| `--all` | 显示全部（含 `unreadCount = 0` 的项）；默认只显示有未读的 |

并发聚合「订阅源列表 + 关注点列表」，等价于 `sub list` + `focus list` 两查。输出分两段：

- **订阅源**：`sourceId`、`类型`、`name`、`unreadCount`
- **关注点**：`id`、`icon`、`title`、`unreadCount`

> 配套的清未读动作只有 `sub mark-read --all` 与 `focus mark-read --all` 两条，均不可逆。

---

## 6. 搜索 `search`

### `supsub search <keyword>` — 全站搜索（源 + 文章）

| 选项 | 说明 | 默认 |
|---|---|---|
| `--type <ALL\|MP\|WEBSITE\|CONTENT>` | 搜索范围：全部 / 公众号 / 网站 / 文章正文 | `ALL` |

输出同时包含「源」与「文章」两类结果，每条带类型、ID、名称/标题、域名、摘要。

> 这是**全站**搜索，不限于自己的订阅。CLI 没有「在我的订阅范围内按关键词搜」的命令；限定到自己范围的请求走 `sub list` / `sub contents` / `focus list` / `focus contents` 浏览。

---

## 7. 公众号 `mp`

| 命令 | 功能 |
|---|---|
| `supsub mp search <name>` | 搜索公众号。后台异步任务，CLI 每 2 秒轮询、最长 30 秒，自动累积去重候选结果（含 `mpId` / 名称 / 描述）。`mpId` 可直接用于 `sub add --mp-id` |
| `supsub mp search-cancel <searchId>` | 取消正在执行的公众号搜索任务 |

---

## 8. 自更新 `update` 与 Skills 同步 `skills`

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

## 9. 输出格式

- **`table`（默认）**：彩色表格，表头青色加粗；对中文/全角字符按 2 列宽度对齐，避免列错位。
- **`-o json`**：向 stdout 输出 `{ "success": true, "data": ... }`，可直接 `jq` 处理。出错时输出 `{ "success": false, "error": {...} }`（同样在 stdout）。
- 成功提示（`✅ 登录成功`、`已登出` 等）走 stderr，因此两种模式下 stdout 都只承载数据。
- **Loading 动画**：发请求 / 轮询等耗时操作期间会在 stderr 显示一个 spinner（如「加载订阅列表…」「搜索公众号「X」中…」「等待浏览器授权中…」），避免黑屏。仅在交互式终端（TTY）下渲染；管道 / 重定向 / CI / 非 TTY 环境自动静默，绝不污染 stdout（`-o json` 与表格数据始终纯净）。可用 `SUPSUB_NO_SPINNER=1` 强制关闭。

---

## 10. 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 一般业务错误 |
| `2` | 未登录 / 鉴权失败 |
| `3` | 套餐已过期 |
| `10` | 网络错误 |
| `11` | 服务端错误 |
| `64` | 参数非法 |

退出码 `64` 覆盖各命令的本地参数校验，典型场景：`--type` 取值不在枚举内、ID 不是正整数、`--all` 与 `--unread` 互斥冲突、`--page-size` 超出 `1`-`100`、`mark-read` 未给 `--all` 或误传单篇参数。这类错误在发请求**之前**抛出，不会产生任何副作用。

可在脚本中据此判断结果，例如配合 `-o json` 做自动化。

---

## 11. 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `SUPSUB_API_KEY` | 注入 API Key（等价于 `--api-key`，但 flag 优先级更高） | 无 |
| `SUPSUB_API_URL` | 覆盖 API 基址（等价于 `--api-url`，但 flag 优先级更高） | `https://supsub.net` |
| `SUPSUB_NO_BROWSER` | 真值时 `auth login` 不自动打开浏览器 | 未设 |
| `SUPSUB_NO_SPINNER` | 真值时关闭所有 loading 动画（非 TTY 下本就不渲染） | 未设 |
| `SUPSUB_NO_SKILLS_NOTIFIER` | 真值时关闭「本地 skills 落后」的启动提示 | 未设 |
| `SUPSUB_CONFIG_DIR` | 覆盖配置目录（凭证存于 `<dir>/config.json`，状态存于 `<dir>/skills-state.json`） | `~/.supsub` |

---

## 12. 凭证存储与优先级

凭证保存在 `~/.supsub/config.json`（目录 `0700` / 文件 `0600`）。每次请求按以下优先级取凭证：

1. `--api-key` 命令行参数
2. `SUPSUB_API_KEY` 环境变量
3. 配置文件中的设备流令牌 / API Key
4. 配置文件中手动粘贴的浏览器会话 token

任意请求返回 401 会自动清除本地凭证，需重新 `auth login`。
