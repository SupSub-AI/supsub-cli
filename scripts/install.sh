#!/usr/bin/env sh
# SupSub CLI native 安装脚本（对标 Claude Code 的 curl | bash 安装）。
#
#   curl -fsSL https://raw.githubusercontent.com/SupSub-AI/supsub-cli/master/scripts/install.sh | bash
#
# 把预编译二进制装进用户目录、版本并存、用 symlink 原子切换当前版本：
#   ~/.local/share/supsub/versions/<version>/supsub      各版本二进制并存
#   ~/.local/bin/supsub -> ../share/supsub/versions/<version>/supsub   PATH 上的 symlink
#
# 装在用户目录 → 永不需要 sudo；版本并存 → 可回滚；symlink 切换 → 原子。
# 之后 `supsub update` / 后台静默自动更新都会沿用这套布局。
#
# 可用环境变量覆盖：
#   SUPSUB_INSTALL_VERSION  指定安装版本（默认取 GitHub 最新 Release）
#   SUPSUB_DATA_DIR         版本并存根目录（默认 ~/.local/share/supsub）
#   SUPSUB_BIN_DIR          symlink 所在目录（默认 ~/.local/bin）
#
# 用 POSIX sh 编写，不依赖 bash 特性；仅需 curl、tar（uname 用于探测平台）。

set -eu

REPO="SupSub-AI/supsub-cli"
BINARY_NAME="supsub"

DATA_DIR="${SUPSUB_DATA_DIR:-$HOME/.local/share/supsub}"
BIN_DIR="${SUPSUB_BIN_DIR:-$HOME/.local/bin}"

info() { printf '\033[36m›\033[0m %s\n' "$1"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$1" >&2; }
err()  { printf '\033[31m✗\033[0m %s\n' "$1" >&2; }

die() { err "$1"; exit 1; }

# ── 探测平台 / 架构，映射到 Release 资产命名段（与 postinstall.cjs / self-update.ts 一致）──
detect_platform() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) PLATFORM="darwin" ;;
    Linux)  PLATFORM="linux" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      die "Windows 暂不支持 native 安装脚本，请改用 npm：npm i -g @supsub/cli" ;;
    *) die "不支持的操作系统：$os（请改用 npm i -g @supsub/cli）" ;;
  esac

  case "$arch" in
    x86_64|amd64) ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) die "不支持的架构：$arch（请改用 npm i -g @supsub/cli）" ;;
  esac
}

# ── 解析要安装的版本号（去掉前导 v）──
# 与 CLI 自身的 checkForUpdate 保持同一「最新版」来源：优先查 npm registry 的 latest
# dist-tag（CLI 也用它），失败再回退 GitHub Release API。二者由同一个 tag 发版、版本一致，
# 且 npm registry 通常更稳、更少被限流。
resolve_version() {
  if [ -n "${SUPSUB_INSTALL_VERSION:-}" ]; then
    VERSION="${SUPSUB_INSTALL_VERSION#v}"
    return
  fi
  info "查询最新版本…"
  # 1) npm registry latest（主）——只用 grep/sed 解析，避免依赖 jq。
  npm_url="https://registry.npmjs.org/@supsub/cli/latest"
  ver="$(curl -fsSL "$npm_url" 2>/dev/null | grep -oE '"version" *: *"[^"]+"' | head -n1 | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')"
  if [ -z "$ver" ]; then
    # 2) 回退 GitHub Release API。
    gh_url="https://api.github.com/repos/${REPO}/releases/latest"
    tag="$(curl -fsSL "$gh_url" 2>/dev/null | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name" *: *"([^"]+)".*/\1/')"
    ver="${tag#v}"
  fi
  [ -n "$ver" ] || die "无法获取最新版本号，请检查网络或用 SUPSUB_INSTALL_VERSION 指定版本"
  VERSION="$ver"
}

# ── 下载并解压到版本目录 ──
install_binary() {
  asset="supsub-cli_${VERSION}_${PLATFORM}_${ARCH}.tar.gz"
  url="https://github.com/${REPO}/releases/download/v${VERSION}/${asset}"
  version_dir="${DATA_DIR}/versions/${VERSION}"
  version_bin="${version_dir}/${BINARY_NAME}"

  info "下载 supsub v${VERSION}（${PLATFORM}/${ARCH}）…"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/supsub-install.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT

  curl -fsSL "$url" -o "${tmp}/${asset}" || die "下载失败：${url}"
  tar -xzf "${tmp}/${asset}" -C "$tmp" "$BINARY_NAME" || die "解压失败：${asset}"

  mkdir -p "$version_dir"
  cp "${tmp}/${BINARY_NAME}" "$version_bin"
  chmod 0755 "$version_bin"
  info "已安装到 ${version_bin}"
}

# ── 原子切换 symlink（先写临时 symlink 再 rename 覆盖）──
link_binary() {
  version_bin="${DATA_DIR}/versions/${VERSION}/${BINARY_NAME}"
  link="${BIN_DIR}/${BINARY_NAME}"
  mkdir -p "$BIN_DIR"
  tmp_link="${BIN_DIR}/.${BINARY_NAME}.tmp.$$"
  rm -f "$tmp_link"
  ln -s "$version_bin" "$tmp_link"
  mv -f "$tmp_link" "$link"
  info "已链接 ${link} -> ${version_bin}"
}

# ── 清理旧版本，只保留最近 3 个（含当前）──
prune_versions() {
  versions_root="${DATA_DIR}/versions"
  [ -d "$versions_root" ] || return 0
  # 按版本号倒序（-V 语义版本排序），跳过最新 3 个，删掉其余。
  # 版本目录名是 semver（纯数字与点），无特殊字符，用 ls 足够安全。
  # shellcheck disable=SC2012
  ls -1 "$versions_root" 2>/dev/null | sort -Vr | tail -n +4 | while IFS= read -r old; do
    [ -n "$old" ] || continue
    [ "$old" = "$VERSION" ] && continue
    rm -rf "${versions_root:?}/${old}"
  done
}

# ── PATH 检查与提示 ──
check_path() {
  case ":${PATH}:" in
    *":${BIN_DIR}:"*)
      info "安装完成。现在可以运行：supsub auth login"
      ;;
    *)
      warn "${BIN_DIR} 不在 PATH 中。请把下面这行加入你的 shell 配置（~/.zshrc / ~/.bashrc / ~/.profile）："
      # 单引号里的 $PATH 是**故意**不展开的——要给用户展示字面 export 语句。
      # shellcheck disable=SC2016
      printf '\n    export PATH="%s:$PATH"\n\n' "$BIN_DIR"
      warn "然后重开终端或 source 配置，再运行：supsub auth login"
      ;;
  esac
}

main() {
  detect_platform
  resolve_version
  install_binary
  link_binary
  prune_versions
  info "SupSub CLI v${VERSION} 安装成功 🎉"
  check_path
}

main "$@"
