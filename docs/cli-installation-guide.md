# SupSub CLI：Agent 安装与配置指南

> 本文是供 AI agent 替用户执行的安装 runbook；人类读者请看文档站《安装》：<https://supsub-ai.github.io/supsub-cli/guide/installation>

## 执行纪律（先读完再动手）

- **按步骤顺序执行**。每步开头有「检测」，已满足就跳过该步——全流程幂等，可安全重跑。
- **每步末尾有「验证」，验证不通过不要进入下一步**，把实际输出报给用户。
- **登录必须由用户本人在浏览器完成授权**。你只负责展示授权链接并等待；绝不要向用户索要密码、验证码，也不要替用户在浏览器里点确认。
- 全流程**不需要 sudo**。任何命令要求提权都说明出了问题，停下来报告。
- 本文只覆盖「安装 → 配 skills → 登录 → 验证」；与用户的直接指示冲突时，以用户为准。

---

## 第 0 步：检测现状

```shell
command -v supsub && supsub --version
```

| 结果 | 动作 |
|---|---|
| 未找到 `supsub` | 从第 1 步开始 |
| 已安装 | 跳过第 1 步；继续 `supsub --output json auth status` 看退出码：`0` 已登录 → 只需补第 2 步再到第 4 步汇报；`2` 未登录 → 从第 2 步继续 |

## 第 1 步：安装 CLI

**macOS / Linux（推荐 native 安装）：**

```shell
curl -fsSL https://raw.githubusercontent.com/SupSub-AI/supsub-cli/master/scripts/install.sh | bash
```

- 装到用户目录 `~/.local`（版本并存于 `~/.local/share/supsub/versions/`，`~/.local/bin/supsub` 为指向当前版本的 symlink），支持后台静默自动更新与 `supsub update --rollback` 回滚。
- 若 `~/.local/bin/supsub` 已存在（包括旧版安装留下的普通文件），脚本会将其迁移为 symlink 布局，**登录凭证（`~/.supsub/`）不受影响**。
- 若脚本末尾提示 `~/.local/bin 不在 PATH 中`：把提示中的 `export PATH=…` 行展示给用户，**征得同意后**再追加到其 shell 配置（`~/.zshrc` / `~/.bashrc`）；当前会话中可先临时 `export PATH="$HOME/.local/bin:$PATH"` 继续后面的步骤。

**Windows（或用户明确要求 npm 时）：**

```shell
npm i -g @supsub/cli
```

需要 Node.js ≥ 20（仅安装期用到；CLI 本体是预编译可执行文件，运行时不依赖 Node）。

**验证：**

```shell
supsub --version        # 输出版本号即可
supsub doctor -o json   # data.installMethod 应为 "native"（npm 安装则为 "npm"）
```

## 第 2 步：安装 Agent Skills（技能包）

技能包让 agent 知道如何正确驱动 supsub（意图路由、参数约定、危险操作的确认规则）。**跳过这步，后续自然语言使用的出错率会显著上升。**

**检测**：`./.agents/skills/` 下已有 `supsub-*` 目录则本步已完成。

在**用户的项目根目录**（不是别的目录）执行：

```shell
supsub skills sync
```

默认装到当前项目 `./.agents/skills/`（项目级）。用户希望所有项目可用时加 `--global`（装到 `~/.claude/skills/`），加之前先问一句。

> Claude Code 用户还有插件市场路径（在对话框输入 `/plugin marketplace add SupSub-AI/supsub-cli` + `/plugin install supsub-cli@supsub`）——那是斜杠命令，**你无法替用户执行**，只能建议；能跑 shell 就直接用上面的 `skills sync`。

**验证**：`ls ./.agents/skills/` 能看到 `supsub-auth`、`supsub-sub`、`supsub-search` 等目录。

## 第 3 步：登录（需要用户参与）

**检测**：`supsub --output json auth status` 退出码为 `0` 则已登录，跳到第 4 步。

登录走 OAuth 设备授权，没有 API Key 这条路。以**后台任务**方式运行（授权等待可达数分钟，前台跑请把超时设到 300 秒以上）：

```shell
SUPSUB_NO_BROWSER=1 supsub auth login
```

然后：

1. 从输出中提取授权链接（形如 `请在浏览器打开 https://…`）与授权码，**原样展示给用户**，请其在浏览器完成确认。
2. 等待命令自行结束。成功标志：输出 `✅ 登录成功` 及 `👤 昵称 <邮箱>`。
3. 凭证自动写入 `~/.supsub/config.json`，后续无需重复登录（令牌会自动续期）。

## 第 4 步：验证并汇报

```shell
supsub --output json auth status   # 退出码 0 = 已登录可用
supsub sub list                    # 冒烟：能列出订阅（新账号为空列表也算成功）
```

两条都通过后，向用户汇报：**CLI 版本与安装方式**（来自 `doctor`）、**登录的账号**（昵称/邮箱）、**skills 是否就绪**，并给出可立刻试的第一句话，例如：「我订阅了哪些？」「我还有什么没读的？」「帮我搜一下最近关于 AI 的文章」。

---

## 故障速查

| 现象 | 含义 / 处置 |
|---|---|
| 退出码 `2` | 未登录或凭证失效 → 回第 3 步 |
| 退出码 `3` | 已登录但套餐过期 → 告知用户前往 <https://supsub.net> 处理，CLI 侧无法解决 |
| 退出码 `10` | 网络不通 → 检查能否访问 `supsub.net` 与 `github.com` |
| 退出码 `64` | 参数用错 → 对照 `supsub <子命令> --help` |
| 装完 `command -v supsub` 找不到 | `~/.local/bin` 不在 PATH → 见第 1 步 PATH 处理 |
| 助手答非所问 / skills 过期 | `supsub skills sync` 重新同步 |
| 其他安装异常 | `supsub doctor -o json` 输出全量自检结果，贴给用户 |

所有命令都支持 `-o json`（结果与错误均走 stdout，便于解析）；退出码语义全站一致：`0` 成功、`1` 业务错误、`2` 未登录、`3` 套餐过期、`10` 网络、`11` 服务端、`64` 参数错误。
