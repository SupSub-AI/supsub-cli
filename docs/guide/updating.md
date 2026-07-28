# 升级与 Skills 同步

SupSub 的「CLI 本体」与「Agent Skills」是两份**独立分发、却一起发版**的产物：

| 产物 | 分发方式 | 安装位置 | 谁来更新 |
|---|---|---|---|
| CLI 二进制 | native 安装脚本 / npm `@supsub/cli` | `~/.local`（native）或 npm 全局 bin | 后台自动更新（native）/ `supsub update` / `npm i -g` |
| Agent Skills | `npx skills add` 拉取仓库 / Claude Code 插件市场 | `./.agents/skills`（项目）或 `~/.claude/skills`（全局） | `supsub skills sync` |

核心矛盾是：**`supsub update` 只换掉二进制，本地 skills 仍停留在旧版**，于是出现「二进制 v0.4.0、本地 skills v0.3.2」的漂移。下面几节分别解决。

## 升级 CLI 二进制

```shell
supsub update            # 检查并更新到最新版，顺带同步本地 skills
supsub update --check    # 只检查有无新版本，不实际更新（也不动 skills）
supsub update --force    # 即使已是最新也重新下载安装（修复损坏的 binary）
supsub update --skip-skills   # 本次更新不同步本地 skills
supsub update --rollback      # 回滚到上一个留存版本（仅 native 安装）
```

说明：

- 更新完成后，下次运行即是新版本。
- **native 安装**：新版本装到 `~/.local/share/supsub/versions/<版本>/` 并原子切换 symlink，旧版本保留最近 3 个可回滚，装在用户目录不需要 sudo。
- **npm 安装**：原地替换 binary；若全局目录无写权限（需 sudo 的路径），会以退出码 `1` 报错并提示改用 `npm i -g @supsub/cli@latest` 或加 `sudo` 重试。
- 更新过程只访问 `registry.npmjs.org` 与 `github.com`，**不读取、不发送任何凭证**。

## 后台自动更新（仅 native 安装）

native 安装会在后台定期检查并升级，**新版本下次启动才生效**，绝不打断当前命令：

- 仅 **native 安装**（`curl … | bash` 装到 `~/.local`）才自动更新；npm 安装保持手动。
- `-o json` 与 CI 环境下**永不**自动更新——那正是 agent / 脚本在跑。
- 设 `SUPSUB_DISABLE_AUTOUPDATER=1` 完全关闭后台检查（`supsub update` 手动更新仍可用）。
- 可在 `~/.supsub/config.json` 配置：
  - `autoUpdateChannel`：`latest`（默认，跟随最新）/ `stable`（只自动升 patch，minor/major 需手动 `supsub update`）；
  - `minimumVersion`：自动更新不会低于此版本。

## 自检当前状态

```shell
supsub doctor            # 表格
supsub doctor -o json    # 供 agent 解析
```

一眼看清：装的是 native 还是 npm、当前版本与真实路径、symlink 指向哪个版本、本地留存版本、上次后台更新检查的时间与结果、`~/.local/bin` 是否在 `PATH`、skills 同步状态。

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
