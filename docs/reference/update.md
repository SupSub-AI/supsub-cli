# `update` / `skills`

## `update` — CLI 自更新

| 命令 | 功能 |
|---|---|
| `supsub update` | 检查并更新到最新版本：查 npm registry 最新版 → 从 GitHub Release 下载对应平台预编译 binary → 原地替换正在运行的可执行文件，并顺带同步本地 skills |
| `supsub update --check` | 只检查是否有新版本，输出 `current` / `latest` / `hasUpdate`，不实际更新（不动 skills） |
| `supsub update --force` | 即使已是最新也重新下载安装（修复损坏的 binary），并重新同步 skills |
| `supsub update --skip-skills` | 本次更新不同步本地 skills |

机制说明：

- 替换采用「同目录暂存 + 原子 `rename`」覆盖自身，Unix 下可覆盖正在运行的可执行文件，更新后下次运行即新版本。
- 下载资产命名与 `scripts/postinstall.cjs` 完全一致（同一套 GitHub Release 包），二者是两条等价的更新路径。
- 若全局安装目录无写权限（如装在需 sudo 的路径），会以退出码 `1` 报错并提示改用 `npm i -g @supsub/cli@latest` 或加 `sudo` 重试。
- 不读取 / 不发送任何凭证，访问的是 `registry.npmjs.org` 与 `github.com`，与 SupSub API 鉴权无关。

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

机制说明：

- CLI 自更新只换二进制，本地 skills 不会自动跟着升级。`~/.supsub/skills-state.json` 记录「上次同步到的 CLI 版本」。
- 每次运行任意命令前，做一次零网络的本地比对：本地 skills 落后于当前二进制时，在 **stderr** 提示运行 `supsub skills sync`（`skills` / `update` / `--help` 等命令不重复打扰）。
- 冷启动（从未通过 supsub 同步过）、CI、`SUPSUB_NO_SKILLS_NOTIFIER` 为真值时不提示。

完整说明见[升级与 Skills 同步](/guide/updating)。
