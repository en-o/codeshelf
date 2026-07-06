#!/usr/bin/env bash
# 推送前校验 release.yml 的构建能跑通：前端 tsc+vite + 后端 cargo 编译校验。
# 严格对齐 CI 里 tauri-action 真正跑的东西：不强制 clippy、不跑 tests，
# 只抓 release 模式编译/类型错。完整 bundle 请自行：
#   npm run tauri build -- --target aarch64-apple-darwin --config src-tauri/tauri.release.conf.json

set -euo pipefail

cd "$(dirname "$0")/.."

# 兜底：在 Windows Git Bash / 某些 shell 下，npm 唤起的 bash 未必继承 ~/.cargo/bin。
# cargo 若不在 PATH，尝试常见安装位置。
if ! command -v cargo >/dev/null 2>&1; then
  for candidate in \
    "$HOME/.cargo/bin" \
    "${USERPROFILE:-}/.cargo/bin" \
    "/c/Users/${USERNAME:-$USER}/.cargo/bin"; do
    if [ -n "$candidate" ] && [ -x "$candidate/cargo" -o -x "$candidate/cargo.exe" ]; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "❌ cargo not found. Install Rust: https://rustup.rs/" >&2
  echo "   Or ensure ~/.cargo/bin is in PATH for the shell npm uses." >&2
  exit 1
fi

echo "==> [1/3] Frontend: npm install + tsc + vite build"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build

echo "==> 校验 sidecar 已生成（装机必需；缺失会导致简历功能报“未找到内置 Node…”）"
SIDECAR_DIR="src-tauri/resources/sidecars"
AGENT_ENTRY="$SIDECAR_DIR/resume-agent/main.cjs"
# node 二进制名随平台不同：Windows 为 node.exe，其余为 node
if [ -f "$SIDECAR_DIR/node/node.exe" ]; then
  NODE_BIN="$SIDECAR_DIR/node/node.exe"
else
  NODE_BIN="$SIDECAR_DIR/node/node"
fi
for f in "$AGENT_ENTRY" "$NODE_BIN"; do
  if [ ! -s "$f" ]; then
    echo "❌ 缺少或为空的 sidecar 文件: $f" >&2
    echo "   请确认 'npm run resume-agent:prepare-sidecar' 已成功执行。" >&2
    exit 1
  fi
done
echo "   ✓ $AGENT_ENTRY"
echo "   ✓ $NODE_BIN"

echo "==> [2/3] Rust: cargo check --release (lib only, 对齐 tauri build)"
(cd src-tauri && cargo check --release --lib --bins)

# Windows 交叉检查：抓 #[cfg(target_os = "windows")] 下的代码错误。
# Mac 原生 cargo check 会把 Windows-only 代码预处理掉，永远看不到错。
# 需要先构建镜像（只跑一次）：
#   docker build -t codeshelf-win-check -f scripts/Dockerfile.win-check .
# 没装 Docker 或镜像不存在时跳过，不阻塞流程。
if command -v docker >/dev/null 2>&1 && docker image inspect codeshelf-win-check >/dev/null 2>&1; then
  echo "==> [3/3] Docker: cargo check --target x86_64-pc-windows-gnu"
  docker run --rm \
    -v "$PWD":/work \
    -v codeshelf-cargo-registry:/usr/local/cargo/registry \
    -v codeshelf-cargo-target-win:/work/src-tauri/target-win \
    -e CARGO_TARGET_DIR=/work/src-tauri/target-win \
    codeshelf-win-check \
    cargo check --release --lib --bins --target x86_64-pc-windows-gnu
else
  echo "==> [3/3] 跳过 Windows 交叉检查（未找到 docker 或镜像 codeshelf-win-check）"
  echo "         首次构建镜像："
  echo "         docker build -t codeshelf-win-check -f scripts/Dockerfile.win-check ."
fi

echo
echo "✅ verify-release 通过。可以安全推到 release/** 分支。"
echo "   tip: 如需跑 clippy（可能报历史告警），单独执行："
echo "        (cd src-tauri && cargo clippy --release)"

