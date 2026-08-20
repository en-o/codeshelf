#!/usr/bin/env bash
# 手动清理 Rust 构建产物。不装任何计划任务，想清的时候自己跑。
#
#   ./scripts/clean-target.sh            # 看看各 target 目录多大（只读，不删）
#   ./scripts/clean-target.sh 10GB       # 用 cargo-sweep 从最旧的产物开始删，压到 10GB 以内
#   ./scripts/clean-target.sh inc        # 只删增量缓存（最快见效，依赖不用重编）
#   ./scripts/clean-target.sh all        # cargo clean，全删，下次构建全量重编
#
# cargo-sweep 未安装时会提示装法：cargo install cargo-sweep
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/src-tauri/target"
ACTION="${1:-}"

sizes() {
  if [ ! -d "$TARGET" ]; then
    echo "target 目录不存在（已经是干净的）"
    return
  fi
  echo "== $TARGET =="
  du -sh "$TARGET" 2>/dev/null
  du -sh "$TARGET"/* 2>/dev/null | sort -h
}

case "$ACTION" in
  "")
    sizes
    echo
    echo "要清理：传 10GB / inc / all（见脚本头部注释）"
    ;;
  inc)
    sizes
    rm -rf "$TARGET/debug/incremental" "$TARGET/release/incremental"
    echo "--- 已删增量缓存 ---"
    sizes
    ;;
  all)
    sizes
    cargo clean --manifest-path "$ROOT/src-tauri/Cargo.toml"
    echo "--- 已全清，下次构建会全量重编 ---"
    ;;
  *)
    if ! command -v cargo-sweep >/dev/null 2>&1; then
      echo "没装 cargo-sweep，先跑：cargo install cargo-sweep" >&2
      exit 1
    fi
    sizes
    # 删的都是可以重新编出来的旧产物，正在用的那份不动
    cargo-sweep sweep --maxsize "$ACTION" "$ROOT/src-tauri"
    echo "--- 已压到 $ACTION 以内 ---"
    sizes
    ;;
esac
