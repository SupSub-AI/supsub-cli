# SupSub CLI 安装指南

> 本指南面向 **AI Agent 与终端用户**：以下步骤可由 agent 按序执行；其中「登录」涉及浏览器授权，需用户协助完成。
> 本文只讲「如何装上并登录到可用」；完整命令清单见 [`cli-features.md`](./cli-features.md)，设备授权时序见 [`cli-auth-flow.md`](./cli-auth-flow.md)。

---

## 环境要求

- **Node.js ≥ 20**：仅用于执行 npm 安装与 postinstall 下载脚本。CLI 本体是预编译可执行文件，**运行时不依赖 Node**。
- **支持平台**：macOS（x64 / arm64）、Linux（x64 / arm64）、Windows（x64）。
- **包管理器**：npm（推荐）或 pnpm。
- **网络**：安装期间需访问 `registry.npmjs.org` 与 `github.com`（postinstall 从 GitHub Release 下载对应平台 binary）。

---

## 第 1 步　安装

```shell
npm i -g @supsub/cli
```

安装过程中 postinstall 会自动从 GitHub Release 下载与当前系统匹配的预编译 binary，并在全局 bin 目录创建 `supsub` 链接。看到 `supsub installed at …` 即安装成功。

> 也可用 pnpm：`pnpm add -g @supsub/cli`。注意 postinstall 的链接逻辑以 **npm 全局 bin** 为准；若用 pnpm 安装后 `supsub` 不在 `PATH`，请确认 npm 全局 bin 目录（`npm prefix -g`/bin）已加入 `PATH`，或改用 `npm i -g`。

---

## 第 2 步（可选）　配置 Agent Skills

若在 Claude Code / Cursor 等 agent 中使用，可安装配套技能包，让 agent 用自然语言驱动 supsub：

```shell
# Claude Code 插件市场
/plugin marketplace add SupSub-AI/supsub-cli
/plugin install supsub-cli@supsub

# 其他兼容 agent（skills CLI）：静默安装仓库内全部 skills 到当前项目（./.agents/skills/）
npx -y skills add SupSub-AI/supsub-cli --skill '*' -y
```

---

## 第 3 步　登录

```shell
supsub auth login
```

- 默认走浏览器 **OAuth 设备授权**：终端打印授权链接与授权码，并自动打开浏览器；用户在浏览器确认后，CLI 轮询拿到令牌即登录成功。
- 授权成功后凭证写入 `~/.supsub/config.json`，终端展示当前用户「昵称 \<邮箱\>」。

**Agent / 无头环境**：设 `SUPSUB_NO_BROWSER=1` 跳过自动打开浏览器，再从终端输出里提取授权链接（形如 `请在浏览器打开 https://…`）交用户在浏览器完成授权：

```shell
SUPSUB_NO_BROWSER=1 supsub auth login
```

---

## 第 4 步　验证

```shell
supsub auth status
```

输出当前登录用户（邮箱 / 昵称）、凭证来源与套餐状态；**退出码 `0`** 表示已登录可用。供 agent 解析时加 `-o json`：

```shell
supsub --output json auth status
```

---

## 升级

```shell
supsub update            # 自更新到最新版本（下载新 binary 原地替换）
supsub update --check    # 只检查是否有新版本，不实际更新
```

也可用包管理器：`npm i -g @supsub/cli@latest`（会触发 postinstall 重新下载 binary）。

> 自更新从 npm registry 查最新版本，再从 GitHub Release 下载对应平台 binary、原地替换正在运行的可执行文件。若全局安装目录无写权限（如装在需 sudo 的路径），会提示改用包管理器或加 `sudo` 重试。

---

## 卸载

```shell
npm rm -g @supsub/cli
```

凭证文件 `~/.supsub/config.json` 不随卸载删除；如需彻底清理，手动删除该目录即可。
