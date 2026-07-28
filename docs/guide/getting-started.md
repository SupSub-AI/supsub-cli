# 快速上手

SupSub CLI 是 [SupSub](https://supsub.net) 的命令行工具，让你在终端里直接管理订阅源、搜索内容、追踪公众号与网站。

## 三步开始用

### 第 1 步　安装

```shell
npm i -g @supsub/cli
```

支持 macOS / Linux / Windows（x64 / arm64）。CLI 本体是预编译可执行文件，**运行时不依赖 Node**——Node 只用于跑安装脚本。详见[安装](./installation)。

### 第 2 步　登录

```shell
supsub auth login
```

会自动打开浏览器走 OAuth 设备授权流程完成登录。无头 / CI 环境设 `SUPSUB_NO_BROWSER=1` 可跳过自动打开浏览器，详见[登录与凭证](./auth)。

### 第 3 步　开始用

```shell
# 看看自己的订阅源
supsub sub list

# 搜一个公众号订上
supsub mp search "阮一峰"

# 搜全站内容
supsub search "RAG"
```

## 常见任务

### 订阅一个公众号

公众号有两个不同的 ID：`mpId`（微信原生 base64 串）和站内 `sourceId`（正整数）。订阅时用前者，之后的日常操作用后者。

```shell
# 1. 先搜公众号，拿到 mpId。这一步是异步轮询，实测约 15-30 秒
supsub mp search "机器之心"

# 2. 用 --mp-id 添加订阅（不需要 --type，默认 MP）
#    可顺带 --group <gid> 一步入组
supsub sub add --mp-id "MzA3MzI4MjgzMw=="

# 3. 之后从 sub list 拿到站内 sourceId，用它看文章
supsub sub list --type MP
supsub sub contents --source-id 5 --type MP --all
```

::: warning `mp search` 会返回一批候选，第一条不一定是你要的
搜「机器之心」实测返回 10 条，里面既有「机器之心PRO会员」「机器之心SOTA模型」这类近名号，也夹着「新智元」「量子位」等无关号。**先核对 `name` 再取 `mpId`**，别无脑取第一条。

结果里带 `isSubscribed`，可以据此跳过已订阅的号。
:::

### 搜索内容

```shell
# 全量搜索（信息源 + 文章）
supsub search "AI"

# 仅搜公众号
supsub search "Agent" --type MP

# 仅搜文章正文
supsub search "Claude" --type CONTENT
```

::: tip 这是全站搜索
`search` 搜的是整个 SupSub 站内，不限于你自己的订阅。CLI **没有**「在我的订阅范围内按关键词搜」这样的命令——想限定在自己范围内，用 `sub list` / `sub contents` / `focus contents` 浏览。
:::

### 浏览某个源「最近」的内容

```shell
# 注意 --all：不加的话只返回未读，读完这个源就会返回空列表
supsub sub contents --source-id 12345 --type MP --all
```

::: warning 「最近」不等于「未读」
`sub contents` / `focus contents` **默认只返回未读**。按时间浏览「最近有什么」必须显式加 `--all`，否则该源读完后返回空列表，看起来像「没有内容」。
:::

### 清理未读

```shell
# 一条命令看全部未读（订阅源 + 关注点）
supsub unread

# 确认某个源读完了，整源标记已读
supsub sub mark-read --source-id 12345 --type MP --all
```

::: danger 标记已读不可逆
后端没有「取消已读」，标错无法恢复。因此 `--all` 是必填参数，用来确保这始终是一次明确动作。另外**只有整源 / 整关注点两档，没有单篇已读**。
:::

### 管理订阅

```shell
# 列出所有订阅源
supsub sub list

# 仅看已订阅的网站
supsub sub list --type WEBSITE

# 取消订阅
supsub sub remove --source-id 12345 --type MP
```

## 接下来

- 分不清订阅源 / 关注点 / 分组？看[核心概念](./concepts)
- 查具体命令和参数：[命令参考](/reference/)
- 不想记命令？[让 AI 助手帮你用](/agents/)
