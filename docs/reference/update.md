# `update` / `doctor` / `skills`

## `update` — CLI 自更新

| 命令 | 功能 |
|---|---|
| `supsub update` | 检查并更新到最新版本，并顺带同步本地 skills |
| `supsub update --check` | 只检查是否有新版本，输出 `current` / `latest` / `hasUpdate`，不实际更新（不动 skills） |
| `supsub update --force` | 即使已是最新也重新下载安装（修复损坏的 binary），并重新同步 skills |
| `supsub update --skip-skills` | 本次更新不同步本地 skills |
| `supsub update --rollback` | 回滚到上一个留存版本（仅 native 安装，重指 symlink，不重新下载） |

说明：

- 更新完成后，下次运行即是新版本。
- **native 安装**：新版本下载到 `~/.local/share/supsub/versions/<版本>/` 并原子切换 symlink，旧版本保留最近 3 个可回滚，装在用户目录不需要 sudo。
- **npm 安装**：原地替换 binary；若全局目录无写权限（如需 sudo 的路径），会以退出码 `1` 报错并提示改用 `npm i -g @supsub/cli@latest` 或加 `sudo` 重试。
- 更新过程只访问 `registry.npmjs.org` 与 `github.com`，不读取 / 不发送任何凭证。

::: tip native 安装会后台静默自动更新
native 安装（`curl … | bash`）会在后台定期检查并升级，新版本**下次启动才生效**，不打断当前命令。`-o json` 与 CI 环境下**永不**自动更新；设 `SUPSUB_DISABLE_AUTOUPDATER=1` 可完全关闭后台检查。npm 安装保持手动更新（`supsub update` 或 `npm i -g @supsub/cli@latest`）。

可在 `~/.supsub/config.json` 配置 `autoUpdateChannel`（`latest` 默认 / `stable` 只自动升 patch）与 `minimumVersion`（自动更新不会低于此版本）。
:::

## `doctor` — 安装 / 更新自检

```shell
supsub doctor          # 人类可读表格
supsub doctor -o json  # 供 agent / 脚本解析
```

输出：当前版本与真实路径、安装方式（native / npm）、symlink 指向哪个版本、本地留存的版本列表、上次后台更新检查的时间与结果（含失败原因）、`~/.local/bin` 是否在 `PATH`、以及本地 skills 同步状态。静默自动更新出问题时，这里是第一查证入口。

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
