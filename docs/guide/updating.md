# 升级与 Skills 同步

SupSub 的「CLI 本体」与「Agent Skills」是两份**独立分发、却一起发版**的产物：

| 产物 | 分发方式 | 安装位置 | 谁来更新 |
|---|---|---|---|
| CLI 二进制 | npm `@supsub/cli` | npm 全局 bin（`supsub`） | `supsub update` / `npm i -g` |
| Agent Skills | `npx skills add` 拉取仓库 / Claude Code 插件市场 | `./.agents/skills`（项目）或 `~/.claude/skills`（全局） | `supsub skills sync` |

核心矛盾是：**`supsub update` 只换掉二进制，本地 skills 仍停留在旧版**，于是出现「二进制 v0.4.0、本地 skills v0.3.2」的漂移。下面两节分别解决。

## 升级 CLI 二进制

```shell
supsub update            # 检查并更新到最新版，顺带同步本地 skills
supsub update --check    # 只检查有无新版本，不实际更新（也不动 skills）
supsub update --force    # 即使已是最新也重新下载安装（修复损坏的 binary）
supsub update --skip-skills   # 本次更新不同步本地 skills
```

说明：

- 更新完成后，下次运行即是新版本。
- 更新过程只访问 `registry.npmjs.org` 与 `github.com`，**不读取、不发送任何凭证**。
- 若全局安装目录无写权限（如装在需 sudo 的路径），会以退出码 `1` 报错并提示改用 `npm i -g @supsub/cli@latest` 或加 `sudo` 重试。

::: tip 不会后台自动更新
CLI 本身不做后台自动更新，也不在启动时检查新版本。除 `supsub update` 外，随时可用包管理器手动更新：`npm i -g @supsub/cli@latest`（会触发 postinstall 重新下载 binary）。
:::

## 同步 Agent Skills

```shell
supsub skills sync            # 同步到当前项目 ./.agents/skills（默认）
supsub skills sync --global   # 改装到全局 ~/.claude/skills
supsub skills sync --force    # 即使已是当前版本也重新同步
supsub skills status          # 查看本地 skills 版本 vs 当前 CLI 版本、是否漂移
supsub skills list            # 列出仓库提供的 skills
```

::: warning 默认是项目级安装
`skills sync` **默认只装到当前项目**（`./.agents/skills`）。全局安装对所有项目可见、侵入性强，需要显式加 `--global`。
:::

## 漂移提示

CLI 检测到本地 skills 版本落后于当前二进制时，会在 **stderr** 提示运行 `supsub skills sync`：

- `skills` / `update` / `--help` 等命令不重复打扰。
- 从未通过 supsub 同步过、CI 环境、以及 `SUPSUB_NO_SKILLS_NOTIFIER` 为真值时不提示。

因为提示走 stderr，`-o json` 的 stdout 数据始终纯净，不会污染 `jq` 管道。

关闭提示：

```shell
export SUPSUB_NO_SKILLS_NOTIFIER=1
```
