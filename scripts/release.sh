#!/bin/bash

# CodeShelf 快速发版脚本
# 用法: ./scripts/release.sh 0.2.0

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 检查版本号参数
if [ -z "$1" ]; then
    echo ""
    echo -e "${YELLOW}CodeShelf 快速发版脚本${NC}"
    echo ""
    echo "用法: $0 <版本号>"
    echo ""
    echo "示例:"
    echo "  $0 0.2.0"
    echo "  $0 1.0.0"
    echo ""
    exit 1
fi

VERSION=$1

# 切到项目根：后面所有 git 操作和 precheck 都假设 cwd 是仓库根
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT" || exit 1

# 前置校验全部交给 scripts/release-precheck.mjs：
# 版本号格式、git 仓库、分支、工作树干净、基线（落后/分叉拦，仅发版提交可领先）、
# release 分支占用。**与 release.bat 共用同一份实现**，避免两边逻辑漂移。
BRANCH_NAME="release/$VERSION"

info "项目目录: $PROJECT_ROOT"
info "目标版本: $VERSION"

node scripts/release-precheck.mjs baseline "$VERSION" || exit 1
success "前置校验通过"

echo ""
info "开始更新版本号..."

# 1. 更新 package.json
info "更新 package.json..."
if [ -f "package.json" ]; then
    # 使用 node 来安全地更新 JSON
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        pkg.version = '$VERSION';
        fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    success "package.json -> $VERSION"
else
    error "找不到 package.json"
fi

# 2. 更新 package-lock.json
info "更新 package-lock.json..."
if [ -f "package-lock.json" ]; then
    npm install --package-lock-only --ignore-scripts --silent 2>/dev/null
    success "package-lock.json -> $VERSION"
else
    warn "找不到 package-lock.json，跳过"
fi

# 3. 更新 src-tauri/tauri.conf.json
info "更新 src-tauri/tauri.conf.json..."
if [ -f "src-tauri/tauri.conf.json" ]; then
    node -e "
        const fs = require('fs');
        const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
        conf.version = '$VERSION';
        fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
    "
    success "src-tauri/tauri.conf.json -> $VERSION"
else
    error "找不到 src-tauri/tauri.conf.json"
fi

# 4. 更新 src-tauri/Cargo.toml
info "更新 src-tauri/Cargo.toml..."
if [ -f "src-tauri/Cargo.toml" ]; then
    # 使用 sed 更新 version（只更新 [package] 下的第一个 version）
    # `case` 而不是 `[[ == pattern ]]`：同样是为了能被 POSIX sh 解析
    #
    # 模式必须允许预览版后缀 `-N`：旧模式匹配不到 `version = "0.2.0-1"`，
    # 会**静默不改**，最后在 CI 的「四处版本号必须一致」处才炸。
    case "$(uname -s)" in
      Darwin)
        # macOS 的 sed 需要 -i ''
        sed -i '' "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\(-[0-9]*\)\{0,1\}\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
        ;;
      *)
        # Linux/WSL 的 sed
        sed -i "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\(-[0-9]*\)\{0,1\}\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
        ;;
    esac
    success "src-tauri/Cargo.toml -> $VERSION"
else
    error "找不到 src-tauri/Cargo.toml"
fi

# 5. 更新 src-tauri/Cargo.lock
info "更新 src-tauri/Cargo.lock..."
if [ -f "src-tauri/Cargo.lock" ]; then
    cd src-tauri
    cargo update -p codeshelf --quiet
    cd ..
    success "src-tauri/Cargo.lock -> $VERSION"
else
    warn "找不到 src-tauri/Cargo.lock，跳过"
fi

echo ""
info "版本号更新完成，开始 Git 操作..."

# 6. Git add —— 只有这五个版本文件
# 换行分隔的普通变量，不用数组 —— 数组赋值 `X=(a b)` 也是 bashism
VERSION_FILES='package.json
package-lock.json
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
src-tauri/Cargo.lock'

info "暂存更改..."
# 只 add **确实存在**的文件：上面对缺失的 lock 文件是「warn 并跳过」，
# 这里若无条件 add 一个不存在的路径，git add 会直接失败，两处行为对不上。
# shellcheck disable=SC2086  # 这里正是要按换行/空白拆成多个参数
for f in $VERSION_FILES; do
    [ -f "$f" ] && git add "$f"
done

# 暂存区只能含版本文件（同样走共用脚本）
node scripts/release-precheck.mjs verify-staged || exit 1

# 7. Git commit
info "提交更改..."
git commit -m "chore: release v$VERSION"
success "提交完成"

# 8. 创建 release 分支
info "创建分支 $BRANCH_NAME..."
git checkout -b "$BRANCH_NAME"
success "分支创建完成"

# 9. 推送到远程
info "推送到远程 origin/$BRANCH_NAME..."
git push origin "$BRANCH_NAME"
success "推送完成"

# 10. 切回 main 分支
info "切回 main 分支..."
git checkout main

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  发版流程启动成功！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "版本号: ${YELLOW}v$VERSION${NC}"
echo -e "分支:   ${YELLOW}$BRANCH_NAME${NC}"
echo ""
echo "接下来请："
echo "  1. 前往 GitHub Actions 查看构建进度"
echo "     https://github.com/en-o/codeshelf/actions"
echo ""
echo "  2. 构建完成后，前往 Releases 页面发布"
echo "     https://github.com/en-o/codeshelf/releases"
echo ""
echo "  3. 发布后可合并回 main 分支："
echo "     git merge $BRANCH_NAME"
echo "     git push origin main"
echo ""
