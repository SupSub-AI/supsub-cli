# SupSub CLI 自更新流程（native 安装 + 二进制 + Skills）

> 本文以 mermaid 图为主，描述 SupSub CLI 的自更新链路：
> 0. **native 安装布局与后台静默自动更新**（对标 Claude Code）——装到 `~/.local` 版本并存、symlink 原子切换、detached 子进程后台升级。见下方「0.5」节。
> 1. **CLI 二进制自更新**（`supsub update`）——查 npm registry 最新版，从 GitHub Release 下载对应平台 binary；native 安装装到 `versions/` 再切 symlink，npm 安装原地替换。
> 2. **Skills 同步**（`supsub skills sync`，并在 `update` 时顺带执行）——把本仓库的 Agent Skills 同步到本地 agent 配置，并用「状态文件 + 漂移检测」解决「CLI/skills 发版后，用户本地 skills 没跟着更新」的问题。
>
> 实现位置：
> `src/lib/self-update.ts`（下载/解压/npm 原地替换）、`src/lib/install-layout.ts`（native 布局、安装方式判定、symlink 切换、版本清理、回滚目标）、
> `src/lib/auto-update.ts`（调度门限、通道/门限判定、detached 子进程、后台更新）、`src/lib/update-state.ts`（后台更新状态文件）、
> `src/commands/update.ts`（update / rollback）、`src/commands/doctor.ts`（自检）、
> `src/lib/skills-sync.ts`（skills 同步）、`src/lib/skills-state.ts`（状态文件）、`src/lib/skills-check.ts`（漂移检测）、
> `src/commands/skills.ts`（skills 命令组）、`src/cli/index.ts`（后台更新调度 + 内部命令入口 + 启动漂移提示）。

---

## 0.5 native 安装布局与后台静默自动更新

对标 Claude Code：**装在用户目录（永不 sudo）+ 版本并存（可回滚）+ symlink 原子切换 + detached 子进程静默升级**。npm 安装当前架构无法安全地静默自更新（全局目录可能需 sudo、原地覆盖不可回滚），故只有 native 安装才自动更新。

### 布局

```
~/.local/share/supsub/versions/<version>/supsub   各版本二进制并存（保留最近 3 个）
~/.local/bin/supsub -> …/versions/<version>/supsub  PATH 上的 symlink（切换 = 先写临时 symlink 再 rename）
```

- `SUPSUB_DATA_DIR` / `SUPSUB_BIN_DIR` 可覆盖两个目录（测试隔离 + 高级自定义）。
- **安装方式判定**（`detectInstallMethod`，互斥四档，从最确定到兜底）：`resolveRealBinary()`（realpath 穿透 symlink）落在 `versions/` 下即 **native**；bun/node 本体为 **dev**；真实路径含 `node_modules` 段为 **npm**（包管理器全局安装）；其余独立二进制为 **manual**（0.4.0 之前 `curl … | bash` 装的普通文件、或手动 cp 到某处的 binary）。判定两端都过一遍 realpath，避免 `/tmp → /private/tmp` 这类 symlink 祖先导致漏判。

### 被困手装用户的一次性迁移（manual → native）

0.4.0 之前 `curl … | bash` 装的是 `~/.local/bin/supsub` **普通文件**（未走版本并存）。这批人跑 `supsub update` 原地覆盖后产物仍是普通文件 → 永远判不成 native → 永远没有后台自动更新和回滚，`doctor` 也误标。为一次收敛，`update` 引入迁移分支（决策抽成纯函数 `planUpdateStrategy`，仿 `planRollback`）：

- `native` → 装到 `versions/` 再原子切 symlink（保留最近 N 个可回滚）。
- `migrate-to-native` → **被困手装用户**：`manual` 且真实路径正好是 native 的 symlink 位（realpath 两端比较）且非 Windows。走与 native 相同的安装路径——下载到 `versions/` 后 `switchToVersion` 用 symlink **原子替换那个普通文件**（`rename` 覆盖普通文件语义正确）。下载 / 落盘全部成功后才换 symlink，中途失败普通文件原样健在。迁移后 `detectInstallMethod` 即判 native，后台自动更新自此生效（下次启动）。
- `in-place` → 其余 non-native（npm 包、或手拷到别处的 manual）沿用原地暂存 + 原子 `rename` 覆盖。npm 由包管理器管理（迁移会造成 PATH 遮蔽与包残留），手拷到别处的 manual 不在 native bin 位、迁了 symlink 也不在 PATH 上，均不迁移。

### 后台更新（绝不阻塞当前命令）

```mermaid
flowchart TD
    Start([任意命令启动]):::start --> Gate{"shouldScheduleAutoUpdate<br/>native? 非 json? 非 CI?<br/>未禁用? 超过检查阈值?"}:::dec
    Gate -->|任一不满足| Skip["不调度（reason: disabled/ci/json/not-native/throttled）"]:::out
    Gate -->|ok| Claim["抢占写 lastCheck=now<br/>（防并发重复 spawn）"]:::step
    Claim --> Spawn["spawn(realBinary, ['__background-update'])<br/>detached + unref"]:::step
    Spawn --> Cont["父进程立刻继续跑旧版命令并退出"]:::out

    Spawn -. 独立于父进程生命周期 .-> Child([子进程 __background-update]):::start
    Child --> Recheck{"再确认 native + 未禁用"}:::dec
    Recheck -->|否| End0([静默退出]):::out
    Recheck -->|是| Chk["checkForUpdate() 查 npm registry"]:::step
    Chk -->|失败| RF["写 lastResult=failed"]:::err
    Chk --> Elig{"evaluateEligibility<br/>通道(latest/stable) + minimumVersion"}:::dec
    Elig -->|不符合| RG["写 lastResult=up-to-date / gated"]:::out
    Elig -->|符合| Inst["installNativeVersion(latest)<br/>装到 versions/"]:::step
    Inst --> Sw["switchToVersion(latest)<br/>原子切 symlink"]:::step
    Sw --> Pr["pruneVersions(3) 清理旧版"]:::step
    Pr --> RU["写 lastResult=updated（新版下次启动生效）"]:::out

    classDef start fill:#e2e8f0,stroke:#475569,color:#111;
    classDef step fill:#bfdbfe,stroke:#1d4ed8,color:#111;
    classDef dec fill:#fde68a,stroke:#b45309,color:#111;
    classDef out fill:#bbf7d0,stroke:#15803d,color:#111;
    classDef err fill:#fecaca,stroke:#b91c1c,color:#111;
```

关键取舍：

- **为什么用 detached 子进程而非「命令结束后 await」**：CLI 是短生命周期进程，主命令一结束进程就退出，挂在事件循环上的异步下载会被掐断。`spawn(detached:true) + unref()` 的子进程独立于父进程生命周期，父进程退出后仍能把下载/切版跑完（已实测：父进程 158ms 退出，子进程约 520ms 后写入结果）。
- **内部命令入口**：`__background-update` 在 `cli/index.ts` 顶部拦截，不进 commander（不污染 help/version）。
- **门限**：`autoUpdateChannel`（`latest` 默认 / `stable` 只自动升 patch——比「延迟发布」实现更简、对小项目更实用）与 `minimumVersion`（自动更新不得降到其以下），存 `~/.supsub/config.json`。
- **静默与 opt-out**：`-o json` / CI 永不自动更新；`SUPSUB_DISABLE_AUTOUPDATER=1` 关闭后台检查；均复用 `skills-check.ts` 的 `isTruthyEnv` / `isCIEnv` 语义。
- **回滚**：`supsub update --rollback` 把 symlink 重指到上一个留存版本，不重新下载。
- **自检**：`supsub doctor` 暴露安装方式、真实路径、symlink 指向、留存版本、上次检查时间与结果、PATH、skills 状态。

### ⚠️ 回滚能力依赖「当前运行的版本」，不是要回滚到的版本

`supsub update --rollback` 是**当前正在跑的这个二进制**里的代码在执行。也就是说：**能不能回滚，取决于当前版本、而非目标版本。** 如果某个版本把 rollback 逻辑写坏了（或删掉了这个功能），用户升上去后就会被**困在那个版本**——`--rollback` 自己也坏了，无法自救。

推论与约束：

- rollback 相关代码（`install-layout.ts` 的 `switchToVersion` / `previousInstalledVersion` / `planRollback`、`update.ts` 的 `handleRollback`）属于「一旦损坏就无法靠自身自救」的关键路径，改动务必保守，单测要覆盖到边界（尤其「当前已是最旧、但留存着更新版本」这一分支）。
- **手动兜底**：即便 CLI 的回滚坏了，用户仍可手动重指 symlink 自救——版本并存于 `~/.local/share/supsub/versions/`，直接把 `~/.local/bin/supsub` 指到想用的那版即可：

  ```shell
  ls ~/.local/share/supsub/versions            # 看有哪些留存版本
  ln -sfn ~/.local/share/supsub/versions/<版本>/supsub ~/.local/bin/supsub   # 手动切回
  ```

---

## 0. 为什么需要两条链路

SupSub 的「CLI 本体」与「Agent Skills」是**两份独立分发、却一起发版**的产物：

| 产物 | 分发方式 | 安装位置 | 谁来更新 |
|------|----------|----------|----------|
| CLI 二进制 | npm `@supsub/cli` → postinstall 从 GitHub Release 下载 | npm 全局 bin（`supsub`） | `supsub update` / `npm i -g` |
| Agent Skills | `npx skills add` 拉取本仓库 / Claude Code 插件市场 | `~/.claude/skills`（全局）或 `./.agents/skills`（项目） | `supsub skills sync` |

**核心矛盾**：`supsub update` 只换掉了二进制，本地 skills 仍停留在旧版——出现「二进制 v0.4.0、本地 skills v0.3.2」的**漂移**。本设计参考 `larksuite/cli` 的 `internal/skillscheck`，用一个**状态文件**记录「上次把 skills 同步到的 CLI 版本」，并在每次运行命令时做一次零网络的本地比对，把漂移暴露出来、引导用户 `supsub skills sync`。

```mermaid
flowchart LR
    Repo["GitHub 仓库<br/>tag vX 一起发版"]:::api
    Npm["npm registry<br/>@supsub/cli@X"]:::api
    Rel["GitHub Release<br/>vX 平台 binary"]:::api

    Bin["本地二进制<br/>supsub (vX)"]:::cli
    Skills["本地 skills<br/>~/.claude/skills"]:::web
    State["状态文件<br/>~/.supsub/skills-state.json"]:::state

    Npm -->|update 查最新版| Bin
    Rel -->|update 下载替换| Bin
    Repo -->|skills sync 拉取| Skills
    Bin -. 写入同步到的版本 .-> State
    State -. 启动比对：版本是否一致 .-> Bin

    classDef cli fill:#bfdbfe,stroke:#1d4ed8,color:#111;
    classDef web fill:#bbf7d0,stroke:#15803d,color:#111;
    classDef api fill:#e9d5ff,stroke:#7c3aed,color:#111;
    classDef state fill:#fde68a,stroke:#b45309,color:#111;
```

---

## 1. CLI 二进制自更新（`supsub update`）

### 1.1 流程图

```mermaid
flowchart TD
    Start([supsub update]):::start --> Check["checkForUpdate()<br/>GET registry.npmjs.org/@supsub/cli/latest"]:::step
    Check -->|网络失败| ErrNet["抛 NETWORK_ERROR<br/>exit 10"]:::err
    Check -->|非 2xx| ErrSrv["抛 SERVER_ERROR<br/>exit 11"]:::err
    Check --> Cmp{"compareSemver(latest, current)"}:::dec

    Cmp -->|"--check"| Report["只报告 current/latest/hasUpdate<br/>不下载、不动 skills"]:::out
    Report --> End1([结束 exit 0]):::start

    Cmp -->|"已最新 且 非 --force"| Skills1["顺带校正本地 skills<br/>runSkillsSync(current)"]:::skill
    Skills1 --> MsgUp2date["✅ 已是最新版本"]:::out --> End2([结束 exit 0]):::start

    Cmp -->|"有新版 或 --force"| Perform["performUpdate(latest)"]:::step
    Perform --> Detect["detectPlatform()<br/>os/arch → Release 资产名"]:::step
    Detect -->|不支持平台| ErrPlat["抛 UPDATE_FAILED"]:::err
    Detect --> DL["下载 supsub-cli_X_OS_ARCH.tar.gz/.zip"]:::step
    DL -->|失败| ErrDL["NETWORK/SERVER_ERROR"]:::err
    DL --> Extract["解压（tar / PowerShell Expand-Archive）"]:::step
    Extract --> Atomic["同目录暂存 .supsub-update-PID<br/>chmod 0755 → 原子 rename 覆盖运行中的二进制"]:::step
    Atomic -->|EACCES/EPERM| ErrPerm["UPDATE_PERMISSION_DENIED<br/>提示改用 npm i -g 或 sudo"]:::err
    Atomic --> Skills2["二进制已换 → 同步 skills 到 latest<br/>runSkillsSync(latest)（best-effort）"]:::skill
    Skills2 --> MsgDone["✅ 已更新 vCur → vLatest<br/>（附 skills 同步结果）"]:::out --> End3([结束 exit 0]):::start

    classDef start fill:#e2e8f0,stroke:#475569,color:#111;
    classDef step fill:#bfdbfe,stroke:#1d4ed8,color:#111;
    classDef dec fill:#fde68a,stroke:#b45309,color:#111;
    classDef out fill:#bbf7d0,stroke:#15803d,color:#111;
    classDef skill fill:#ddd6fe,stroke:#6d28d9,color:#111;
    classDef err fill:#fecaca,stroke:#b91c1c,color:#111;
```

### 1.2 关键点

- **版本来源**：npm registry 的 `latest` dist-tag（`checkForUpdate`）；`compareSemver` 只比较 `major.minor.patch`，忽略 `v` 前缀与 prerelease 尾巴。
- **资产命名**：`supsub-cli_<version>_<os>_<arch>.<ext>`，与 `scripts/postinstall.cjs` 同一套规则（`buildDownloadUrl` + `detectPlatform`）。
- **原地替换**：先在**二进制同目录**暂存（避免跨文件系统 `EXDEV`），`chmod 0755` 后用 `rename` 原子覆盖——`rename` 可以替换正在运行的可执行文件。
- **独立 fetch**：目标是 `registry.npmjs.org` / `github.com`，不走 `http/client.ts` 的鉴权与 401→clearAuth（与 `api/auth.ts` 的 device 端点同理）。
- **退出码**：沿用 `src/lib/exit-code.ts`（NETWORK=10，SERVER=11，权限/未知归入 SERVER）。
- **与 skills 的衔接**：真正替换二进制后（以及「已最新」分支）调用 `runSkillsSync` 把本地 skills 拉到目标版本；**skills 同步失败不影响二进制更新的既成事实**，只降级为一条 stderr 警告。可用 `--skip-skills` 跳过。

---

## 2. Skills 同步与漂移检测

### 2.1 状态文件 `~/.supsub/skills-state.json`

漂移检测的**唯一依据**。每次 `skills sync` 成功后写入：

```json
{
  "version": "0.3.2",
  "skills": ["supsub-auth", "supsub-sub", "supsub-search", "supsub-mp", "supsub-focus"],
  "scope": "project",
  "syncedAt": "2026-06-29T12:00:00.000Z"
}
```

- 与 `config.json` 同目录（`~/.supsub`，可被 `SUPSUB_CONFIG_DIR` 覆盖），目录 `0700`、文件 `0600`。
- `version` = 同步时的 CLI 版本；漂移检测就是比对它和当前运行二进制的版本。
- 文件缺失 / 损坏一律视为 `null`（**从未通过 supsub 同步过**）——冷启动不打扰用户。

### 2.2 同步流程（`supsub skills sync`）

```mermaid
flowchart TD
    Start(["supsub skills sync<br/>[--global] [--force]"]):::start --> Read["readSkillsState()"]:::step
    Read --> Dec{"非 --force 且<br/>state.version == CLI 版本 且<br/>scope 一致 且 skills 非空？"}:::dec
    Dec -->|是| UpToDate["✅ 本地 skills 已是最新<br/>跳过 npx 子进程"]:::out --> End1([exit 0]):::start
    Dec -->|否| Build["buildSkillsAddArgs(scope)<br/>npx -y skills add OWNER/REPO [-g] -y"]:::step
    Build --> Run["activeRunner(args)<br/>（execFile npx，可注入以便测试）"]:::step
    Run -->|ENOENT（无 npx）| ErrTool["SKILLS_TOOL_NOT_FOUND<br/>提示安装 Node.js / 手动 npx"]:::err
    Run -->|其他失败| ErrSync["SKILLS_SYNC_FAILED<br/>附 stdout/stderr 截断"]:::err
    Run -->|成功| Write["writeSkillsState({version, skills, scope, syncedAt})"]:::step
    Write --> Done["✅ 已同步 N 个 skills 到 vX"]:::out --> End2([exit 0]):::start

    classDef start fill:#e2e8f0,stroke:#475569,color:#111;
    classDef step fill:#bfdbfe,stroke:#1d4ed8,color:#111;
    classDef dec fill:#fde68a,stroke:#b45309,color:#111;
    classDef out fill:#bbf7d0,stroke:#15803d,color:#111;
    classDef err fill:#fecaca,stroke:#b91c1c,color:#111;
```

- **同步机制**：复用社区 `skills` CLI（`npx -y skills add <owner/repo> [-g] -y`），直接从本仓库 GitHub 源拉取——与 README 既有文档、`larksuite/cli` 的 `runSkillsAdd` 同一套命令。
- **范围**：默认 `project`（不带 `-g`，装到当前项目 `./.agents/skills`，**不污染其他项目**）；`--global` 加 `-g`，装到 `~/.claude/skills` 对所有项目可见。全局安装侵入性强，改为显式 opt-in。
- **自更新沿用既有范围**：`supsub update` 顺带的自动同步会读取 `skills-state.json` 里上次的 `scope`，装在哪就同步到哪（老的全局用户保持全局，不会被悄悄改成项目级）；从未同步过则走默认 `project`。
- **runner 可注入**（`setSkillsSyncRunner`）：测试用 fake runner 替换，不真的起子进程 / 连网。
- **owner/repo 来源**：`getRepoSlug()` 解析 `package.json#repository.url`，与 Release 资产同源。

### 2.3 漂移检测（每次运行命令时）

```mermaid
flowchart TD
    Run([任意 supsub 命令启动]):::start --> Guard{"argv 是 skills/update/help/version？"}:::dec
    Guard -->|是| Skip1["不提示<br/>（这些命令本身在处理同步）"]:::out
    Guard -->|否| Skip{"shouldSkipSkillsCheck()<br/>CI / SUPSUB_NO_SKILLS_NOTIFIER / 空版本？"}:::dec
    Skip -->|跳过| Skip2["不提示"]:::out
    Skip -->|继续| ReadV["readSyncedVersion()"]:::step
    ReadV -->|null（从未同步）| Cold["不提示（冷启动）"]:::out
    ReadV --> Eq{"归一化后<br/>synced == 当前 CLI 版本？"}:::dec
    Eq -->|相等| NoDrift["不提示"]:::out
    Eq -->|不等| Notice["stderr 打印一行：<br/>⚠ 本地 skills vA 与 CLI vB 不一致，<br/>运行 supsub skills sync 同步"]:::warn
    NoDrift --> Dispatch["继续派发命令"]:::step
    Notice --> Dispatch

    classDef start fill:#e2e8f0,stroke:#475569,color:#111;
    classDef step fill:#bfdbfe,stroke:#1d4ed8,color:#111;
    classDef dec fill:#fde68a,stroke:#b45309,color:#111;
    classDef out fill:#bbf7d0,stroke:#15803d,color:#111;
    classDef warn fill:#fed7aa,stroke:#c2410c,color:#111;
```

- **零成本**：只读一次本地状态文件，**无网络、无子进程**，放在 `cli/index.ts` 派发命令前执行。
- **只写 stderr**：绝不污染 stdout / `-o json` 的数据，agent 也能从 stderr 解析到这行提示。
- **不打扰原则**：
  - 冷启动（无状态文件）不提示——避免打扰「只用插件市场装 skills、从不经 supsub 同步」的用户；
  - `skills` / `update` / `--help` / `--version` 命令不提示——用户已经在处理；
  - CI / `SUPSUB_NO_SKILLS_NOTIFIER` / 开发版（空、`0.0.0`、`dev`）跳过。

---

## 3. 两条链路如何协同解决「本地未同步」

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant C as supsub (旧 vA)
    participant N as npm registry
    participant R as GitHub Release / 仓库
    participant S as skills-state.json
    participant L as 本地 skills

    Note over C,S: 已通过 supsub 同步过，state.version = vA
    U->>C: supsub update
    C->>N: 查 latest → vB (> vA)
    C->>R: 下载 vB 平台 binary
    C-->>C: 原子替换 → 二进制已是 vB
    C->>R: npx skills add OWNER/REPO -g -y
    R-->>L: 安装/更新 skills 到最新
    C->>S: 写 state.version = vB
    Note over C,S: 二进制与 skills 同时到达 vB，无漂移

    Note over U,L: 若用户改用 npm i -g 升级（绕过 supsub update）
    U->>C: npm i -g @supsub/cli@latest
    C-->>C: 二进制变 vB，但 state 仍是 vA
    U->>C: supsub sub list（下次任意命令）
    C-->>U: ⚠ stderr 提示 skills vA 与 CLI vB 不一致
    U->>C: supsub skills sync
    C->>R: npx skills add ...
    R-->>L: skills 更新到最新
    C->>S: 写 state.version = vB
```

- **理想路径**：`supsub update` 一步到位——二进制与 skills 一起升级、状态写齐，下次启动无提示。
- **兜底路径**：用户用 `npm i -g`（或包管理器）只换了二进制，漂移检测会在下一条命令把不一致暴露到 stderr，引导 `supsub skills sync`。
- **不可逆/破坏性**：均无。`skills sync` 是幂等覆盖安装；二进制替换有同目录暂存兜底，权限不足时明确报错而非半残。

---

## 4. 命令与环境变量速查

| 命令 | 作用 |
|------|------|
| `supsub update` | 二进制自更新，并顺带同步本地 skills |
| `supsub update --check` | 只查版本，不下载、不动 skills |
| `supsub update --force` | 即使已最新也重装二进制并重同步 skills |
| `supsub update --skip-skills` | 本次更新不同步 skills |
| `supsub skills sync` | 同步本地 skills 到当前 CLI 版本（默认仅当前项目；`--global` 装到全局、`--force` 强制重装） |
| `supsub skills status` | 查看本地 skills 版本 vs CLI 版本、是否漂移 |
| `supsub skills list` | 列出本仓库提供的 skills |

| 环境变量 | 作用 |
|----------|------|
| `SUPSUB_NO_SKILLS_NOTIFIER` | 真值时关闭启动漂移提示（不影响二进制更新提示） |
| `SUPSUB_CONFIG_DIR` | 覆盖配置 / 状态文件目录（默认 `~/.supsub`），测试隔离用 |
| `CI` / `CONTINUOUS_INTEGRATION` | 真值时跳过漂移提示 |
