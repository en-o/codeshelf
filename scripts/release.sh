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

# 验证版本号格式 (x.y.z)。
# 用 grep -E 而不是 `[[ =~ ]]`：后者是 bashism，`sh scripts/release.sh` 会解析失败。
# 规则与 scripts/release.bat 保持一致。
if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
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

# 检查当前是否在 main 分支
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    error "当前分支是 $CURRENT_BRANCH，请在 main 分支上运行此脚本"
fi

# 工作树与暂存区必须干净。
#
# 之前这段检查是注释掉的，而脚本只 `git add` 五个版本文件 —— 组合起来有两个坑：
#   1. 预先 staged 的文件会被 `git commit` 一并带进发版提交（不在那五个文件里，
#      却出现在 release 分支上）；
#   2. 未暂存的改动参与了本地构建和校验，却**不会**进入 release，
#      于是「我本地测过」和「发出去的包」根本不是同一份代码。
if [ -n "$(git status --porcelain)" ]; then
    echo ""
    git status --short
    echo ""
    error "工作树/暂存区不干净（见上）。发版必须从确定的源码开始：请先提交或 stash。"
fi

# 基线必须与远程一致，否则发出去的 commit 不是团队看到的那个
info "校验 main 与 origin/main 是否同步..."
git fetch origin main --quiet || error "无法 fetch origin/main，请检查网络或远程配置"

LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)
BASE_SHA=$(git merge-base HEAD origin/main)

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    if [ "$LOCAL_SHA" = "$BASE_SHA" ]; then
        error "本地 main 落后于 origin/main，请先 git pull"
    elif [ "$REMOTE_SHA" = "$BASE_SHA" ]; then
        error "本地 main 领先于 origin/main（有未推送的提交），请先 git push"
    else
        error "本地 main 与 origin/main 已分叉，请先处理后再发版"
    fi
fi
success "基线一致: $LOCAL_SHA"

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
    case "$(uname -s)" in
      Darwin)
        # macOS 的 sed 需要 -i ''
        sed -i '' "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
        ;;
      *)
        # Linux/WSL 的 sed
        sed -i "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
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
# shellcheck disable=SC2086  # 这里正是要按换行/空白拆成多个参数
git add $VERSION_FILES

# 提交内容必须**可预测**：因为开工前已确认工作树干净，此刻 staged 的应当
# 恰好是这五个文件。多出任何一个都说明中途有别的东西混进来了，停下来。
STAGED=$(git diff --cached --name-only | sort)
EXPECTED=$(printf '%s\n' "$VERSION_FILES" | sort)
# 用 grep 而不是 `comm <(…) <(…)`：进程替换是 bashism，
# 脚本一旦被 `sh scripts/release.sh` 这样调用就会在**解析期**报
# 「syntax error near unexpected token `('」，连第一行都跑不到。
# `grep -vxF` 的语义等价：取 STAGED 中不与 EXPECTED 任何一行完全相同的行。
# grep 无匹配时返回 1，配合 set -e 会误退出，所以补 `|| true`。
UNEXPECTED=$(printf '%s\n' "$STAGED" | grep -vxF "$EXPECTED" || true)
if [ -n "$UNEXPECTED" ]; then
    echo ""
    echo "$UNEXPECTED"
    echo ""
    error "暂存区出现了非版本文件（见上），已中止。发版提交只应包含版本号改动。"
fi

info "本次发版提交将包含："
echo "$STAGED" | sed 's/^/    /'

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
