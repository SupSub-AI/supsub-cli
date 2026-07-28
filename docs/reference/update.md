# `update` / `skills`

## `update` — CLI 自更新

| 命令 | 功能 |
|---|---|
| `supsub update` | 检查并更新到最新版本，并顺带同步本地 skills |
| `supsub update --check` | 只检查是否有新版本，输出 `current` / `latest` / `hasUpdate`，不实际更新（不动 skills） |
| `supsub update --force` | 即使已是最新也重新下载安装（修复损坏的 binary），并重新同步 skills |
| `supsub update --skip-skills` | 本次更新不同步本地 skills |

说明：

- 更新完成后，下次运行即是新版本。
- 若全局安装目录无写权限（如装在需 sudo 的路径），会以退出码 `1` 报错并提示改用 `npm i -g @supsub/cli@latest` 或加 `sudo` 重试。
- 更新过程只访问 `registry.npmjs.org` 与 `github.com`，不读取 / 不发送任何凭证。

::: tip 不做后台自动更新
CLI 本身不做后台自动更新，也不在启动时检查新版本。除 `supsub update` 外，也可随时用包管理器手动更新：`npm i -g @supsub/cli@latest`（会触发 postinstall 重新下载 binary）。
:::

## `skills` — Agent Skills 同步

| 命令 | 功能 |
|---|---|
| `supsub skills sync` | 用 `npx skills add` 把仓库 skills 同步到本地 agent 配置，**默认仅装到当前项目** `./.agents/skills`，成功后记录同步版本 |
| `supsub skills sync --global` | 改装到全局 `~/.claude/skills`（对所有项目可见；全局侵入性强，需显式指定） |
| `supsub skills sync --force` | 即使本地已是当前版本也重新同步 |
| `supsub skills status` | 查看本地 skills 版本 vs 当前 CLI 版本、是否漂移 |
| `supsub skills list` | 列出仓库提供的 skills |

说明：

- CLI 自更新只换二进制，本地 skills 不会自动跟着升级。
- 检测到本地 skills 落后于当前 CLI 版本时，在 **stderr** 提示运行 `supsub skills sync`（`skills` / `update` / `--help` 等命令不重复打扰）。
- 从未通过 supsub 同步过、CI 环境、以及 `SUPSUB_NO_SKILLS_NOTIFIER` 为真值时不提示。

完整说明见[升级与 Skills 同步](/guide/updating)。
