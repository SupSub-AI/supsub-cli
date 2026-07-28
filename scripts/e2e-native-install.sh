#!/usr/bin/env bash
# native 安装 / 版本管理 / 自更新门限的端到端回归 harness（确定性、离线、隔离）。
#
# 覆盖单元测试之外的「整二进制真实行为」：doctor 输出、rollback 两种路径、版本保留、
# 以及后台自动更新的调度门限（json / CI / 禁用 / npm 方式一律不调度）。全程用
# SUPSUB_DATA_DIR / SUPSUB_BIN_DIR / SUPSUB_CONFIG_DIR 把布局隔离到临时目录，**绝不**
# 碰真实 ~/.local、~/.supsub；退出时清理。
#
# 用法：
#   pnpm build            # 先产出 dist/supsub（默认被测二进制）
#   bash scripts/e2e-native-install.sh
# 可选：
#   SUPSUB_E2E_BIN=/path/to/supsub   指定被测二进制（默认 dist/supsub）
#
# 注意本 harness **不覆盖真实版本升级 / 后台真下载 / install.sh 联网安装**——那些需要
# 网络与「低版本起点」的构造，请见 PR 描述里的手工实测记录。这里只跑离线可确定复现的部分。
#
# 为什么不走 bun test：这些场景要跑**编译后的整二进制**（含 detached 子进程 / commander
# 派发 / 退出码），与进程内单测互补；放 scripts/ 作为 opt-in 冒烟，语义更贴近真实使用。

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${SUPSUB_E2E_BIN:-$ROOT_DIR/dist/supsub}"

pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
head() { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }

[ -x "$BIN" ] || { echo "找不到被测二进制：$BIN（先 pnpm build 或设 SUPSUB_E2E_BIN）"; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/supsub-e2e.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# 隔离到临时目录 + 关后台自更新（除非某个用例显式打开），绝不碰真实目录。
export SUPSUB_CONFIG_DIR="$WORK/cfg"
export SUPSUB_DATA_DIR="$WORK/share/supsub"
export SUPSUB_BIN_DIR="$WORK/bin"
export SUPSUB_DISABLE_AUTOUPDATER=1

# 在临时布局里「装」一个版本：把被测二进制拷进 versions/<v>/，可选切 symlink。
place() { # $1=version [$2=link]
  mkdir -p "$SUPSUB_DATA_DIR/versions/$1"
  cp "$BIN" "$SUPSUB_DATA_DIR/versions/$1/supsub"
  chmod 0755 "$SUPSUB_DATA_DIR/versions/$1/supsub"
  if [ "${2:-}" = link ]; then
    mkdir -p "$SUPSUB_BIN_DIR"
    ln -sf "$SUPSUB_DATA_DIR/versions/$1/supsub" "$SUPSUB_BIN_DIR/supsub"
  fi
}
reset_layout() { rm -rf "$SUPSUB_DATA_DIR" "$SUPSUB_BIN_DIR" "$SUPSUB_CONFIG_DIR"; }
link_target()  { readlink "$SUPSUB_BIN_DIR/supsub" 2>/dev/null | sed 's#.*/versions/##; s#/supsub$##'; }

VER="$("$BIN" --version)"

head "doctor：native 布局识别 + json 合法"
reset_layout; place "$VER" link
if "$SUPSUB_BIN_DIR/supsub" -o json doctor 2>/dev/null | jq -e '.success and .data.installMethod=="native"' >/dev/null; then
  ok "doctor -o json：合法 JSON 且 installMethod=native"
else bad "doctor json 非法或未识别为 native"; fi
"$SUPSUB_BIN_DIR/supsub" doctor >/dev/null 2>&1 && ok "doctor 表格模式 exit 0" || bad "doctor 表格模式非 0"

head "rollback：双版本切回上一版并可运行"
reset_layout; place 0.0.1; place "$VER" link
"$SUPSUB_BIN_DIR/supsub" update --rollback >/dev/null 2>&1
if [ "$(link_target)" = "0.0.1" ]; then ok "symlink 重指到 0.0.1"; else bad "rollback 未切到 0.0.1（实为 $(link_target)）"; fi
"$SUPSUB_BIN_DIR/supsub" --version >/dev/null 2>&1 && ok "回滚后的二进制可运行" || bad "回滚后二进制不可运行"

head "rollback：仅一个版本时干净报错（非崩溃）"
reset_layout; place "$VER" link
out="$("$SUPSUB_BIN_DIR/supsub" update --rollback 2>&1)"; code=$?
if [ "$code" = 1 ] && printf '%s' "$out" | grep -q '没有可回滚'; then ok "exit 1 + 清晰报错"; else bad "预期 exit1+报错，得 exit=$code：$out"; fi
# 先抓输出再喂 jq：命令本就以 exit 1 表达错误，pipefail 下直接 pipe 会误判。
jout="$("$SUPSUB_BIN_DIR/supsub" -o json update --rollback 2>/dev/null)"
if printf '%s' "$jout" | jq -e '.success==false and (.error|type=="object")' >/dev/null 2>&1; then
  ok "json 模式返回合法错误信封"
else bad "json 错误信封不合法：$jout"; fi

head "调度门限：以下条件一律不调度后台更新（无 update-state 产生）"
assert_not_scheduled() { # $1=描述
  sleep 1
  if [ -f "$SUPSUB_CONFIG_DIR/update-state.json" ]; then bad "$1：竟然调度了"; else ok "$1：未调度"; fi
}
# json 输出（-o json 等同 agent/脚本路径）
reset_layout; place "$VER" link
env -u SUPSUB_DISABLE_AUTOUPDATER -u CI "$SUPSUB_BIN_DIR/supsub" -o json auth status >/dev/null 2>&1
assert_not_scheduled "json 模式"
# CI
reset_layout; place "$VER" link
env -u SUPSUB_DISABLE_AUTOUPDATER CI=1 "$SUPSUB_BIN_DIR/supsub" auth status >/dev/null 2>&1
assert_not_scheduled "CI=1"
# 显式禁用
reset_layout; place "$VER" link
env -u CI SUPSUB_DISABLE_AUTOUPDATER=1 "$SUPSUB_BIN_DIR/supsub" auth status >/dev/null 2>&1
assert_not_scheduled "SUPSUB_DISABLE_AUTOUPDATER=1"
# npm 方式（二进制在 versions/ 之外，DATA_DIR 指向空目录）
reset_layout; mkdir -p "$WORK/npmbin" "$SUPSUB_CONFIG_DIR"; cp "$BIN" "$WORK/npmbin/supsub"
env -u SUPSUB_DISABLE_AUTOUPDATER -u CI SUPSUB_DATA_DIR="$WORK/emptydata" "$WORK/npmbin/supsub" auth status >/dev/null 2>&1
assert_not_scheduled "npm 方式"
if env SUPSUB_DATA_DIR="$WORK/emptydata" "$WORK/npmbin/supsub" -o json doctor 2>/dev/null | jq -e '.data.installMethod=="npm"' >/dev/null; then
  ok "npm 方式：doctor 报 installMethod=npm"
else bad "npm 方式：doctor 未报 npm"; fi

printf '\n\033[1m结果：%d 通过，%d 失败\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
