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

# 验证版本号格式 (x.y.z)
if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    error "版本号格式无效: $VERSION (应为 x.y.z 格式，如 0.2.0)"
fi

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

info "项目目录: $PROJECT_ROOT"
info "目标版本: $VERSION"

# 检查是否在 git 仓库中
if [ ! -d ".git" ]; then
    error "当前目录不是 git 仓库"
fi

# 检查工作区是否干净（可选，允许有未提交的更改）
# if [ -n "$(git status --porcelain)" ]; then
#     warn "工作区有未提交的更改，将一并提交"
# fi

# 检查 release 分支是否已存在
BRANCH_NAME="release/$VERSION"
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    error "本地分支 $BRANCH_NAME 已存在，请先删除: git branch -D $BRANCH_NAME"
fi

if git ls-remote --exit-code --heads origin "$BRANCH_NAME" &>/dev/null; then
    error "远程分支 origin/$BRANCH_NAME 已存在，请先删除或使用其他版本号"
fi

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

# 2. 更新 src-tauri/tauri.conf.json
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

# 3. 更新 src-tauri/Cargo.toml
info "更新 src-tauri/Cargo.toml..."
if [ -f "src-tauri/Cargo.toml" ]; then
    # 使用 sed 更新 version（只更新 [package] 下的第一个 version）
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS 的 sed 需要 -i ''
        sed -i '' "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
    else
        # Linux/WSL 的 sed
        sed -i "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
    fi
    success "src-tauri/Cargo.toml -> $VERSION"
else
    error "找不到 src-tauri/Cargo.toml"
fi

# 4. 更新 src-tauri/Cargo.lock
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

# 5. Git add
info "暂存更改..."
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock

# 6. Git commit
info "提交更改..."
git commit -m "chore: release v$VERSION"
success "提交完成"

# 7. 创建 release 分支
info "创建分支 $BRANCH_NAME..."
git checkout -b "$BRANCH_NAME"
success "分支创建完成"

# 8. 推送到远程
info "推送到远程 origin/$BRANCH_NAME..."
git push origin "$BRANCH_NAME"
success "推送完成"

# 9. 切回 main 分支
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
