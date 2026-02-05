@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: CodeShelf 快速发版脚本 (Windows)
:: 用法: release.bat 0.2.0

:: 颜色不好在 cmd 中实现，使用简单的前缀代替

if "%~1"=="" (
    echo.
    echo CodeShelf 快速发版脚本
    echo.
    echo 用法: %~nx0 ^<版本号^>
    echo.
    echo 示例:
    echo   %~nx0 0.2.0
    echo   %~nx0 1.0.0
    echo.
    exit /b 1
)

set VERSION=%~1

:: 验证版本号格式 (简单检查是否包含两个点)
for /f "tokens=1,2,3 delims=." %%a in ("%VERSION%") do (
    if "%%c"=="" (
        echo [ERROR] 版本号格式无效: %VERSION% ^(应为 x.y.z 格式，如 0.2.0^)
        exit /b 1
    )
)

:: 切换到脚本所在目录的父目录（项目根目录）
cd /d "%~dp0.."
set PROJECT_ROOT=%cd%

echo [INFO] 项目目录: %PROJECT_ROOT%
echo [INFO] 目标版本: %VERSION%

:: 检查是否在 git 仓库中
if not exist ".git" (
    echo [ERROR] 当前目录不是 git 仓库
    exit /b 1
)

:: 检查 release 分支是否已存在
set BRANCH_NAME=release/%VERSION%

git show-ref --verify --quiet "refs/heads/%BRANCH_NAME%" 2>nul
if not errorlevel 1 (
    echo [ERROR] 本地分支 %BRANCH_NAME% 已存在，请先删除: git branch -D %BRANCH_NAME%
    exit /b 1
)

git ls-remote --exit-code --heads origin "%BRANCH_NAME%" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] 远程分支 origin/%BRANCH_NAME% 已存在，请先删除或使用其他版本号
    exit /b 1
)

echo.
echo [INFO] 开始更新版本号...

:: 1. 更新 package.json
echo [INFO] 更新 package.json...
if not exist "package.json" (
    echo [ERROR] 找不到 package.json
    exit /b 1
)

node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='%VERSION%';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"
if errorlevel 1 (
    echo [ERROR] 更新 package.json 失败
    exit /b 1
)
echo [SUCCESS] package.json -^> %VERSION%

:: 2. 更新 package-lock.json
echo [INFO] 更新 package-lock.json...
if exist "package-lock.json" (
    npm install --package-lock-only --ignore-scripts --silent 2>nul
    if errorlevel 1 (
        echo [ERROR] 更新 package-lock.json 失败
        exit /b 1
    )
    echo [SUCCESS] package-lock.json -^> %VERSION%
) else (
    echo [WARN] 找不到 package-lock.json，跳过
)

:: 3. 更新 src-tauri/tauri.conf.json
echo [INFO] 更新 src-tauri/tauri.conf.json...
if not exist "src-tauri\tauri.conf.json" (
    echo [ERROR] 找不到 src-tauri/tauri.conf.json
    exit /b 1
)

node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));c.version='%VERSION%';fs.writeFileSync('src-tauri/tauri.conf.json',JSON.stringify(c,null,2)+'\n');"
if errorlevel 1 (
    echo [ERROR] 更新 src-tauri/tauri.conf.json 失败
    exit /b 1
)
echo [SUCCESS] src-tauri/tauri.conf.json -^> %VERSION%

:: 4. 更新 src-tauri/Cargo.toml
echo [INFO] 更新 src-tauri/Cargo.toml...
if not exist "src-tauri\Cargo.toml" (
    echo [ERROR] 找不到 src-tauri/Cargo.toml
    exit /b 1
)

node -e "const fs=require('fs');let c=fs.readFileSync('src-tauri/Cargo.toml','utf8');c=c.replace(/^version = \"[0-9]+\.[0-9]+\.[0-9]+\"/m,'version = \"%VERSION%\"');fs.writeFileSync('src-tauri/Cargo.toml',c);"
if errorlevel 1 (
    echo [ERROR] 更新 src-tauri/Cargo.toml 失败
    exit /b 1
)
echo [SUCCESS] src-tauri/Cargo.toml -^> %VERSION%

:: 5. 更新 src-tauri/Cargo.lock
echo [INFO] 更新 src-tauri/Cargo.lock...
if exist "src-tauri\Cargo.lock" (
    pushd src-tauri
    cargo update -p codeshelf --quiet
    popd
    if errorlevel 1 (
        echo [ERROR] 更新 src-tauri/Cargo.lock 失败
        exit /b 1
    )
    echo [SUCCESS] src-tauri/Cargo.lock -^> %VERSION%
) else (
    echo [WARN] 找不到 src-tauri/Cargo.lock，跳过
)

echo.
echo [INFO] 版本号更新完成，开始 Git 操作...

:: 6. Git add
echo [INFO] 暂存更改...
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
if errorlevel 1 (
    echo [ERROR] git add 失败
    exit /b 1
)

:: 7. Git commit
echo [INFO] 提交更改...
git commit -m "chore: release v%VERSION%"
if errorlevel 1 (
    echo [ERROR] git commit 失败
    exit /b 1
)
echo [SUCCESS] 提交完成

:: 7. 创建 release 分支
echo [INFO] 创建分支 %BRANCH_NAME%...
git checkout -b "%BRANCH_NAME%"
if errorlevel 1 (
    echo [ERROR] 创建分支失败
    exit /b 1
)
echo [SUCCESS] 分支创建完成

:: 8. 推送到远程
echo [INFO] 推送到远程 origin/%BRANCH_NAME%...
git push origin "%BRANCH_NAME%"
if errorlevel 1 (
    echo [ERROR] 推送失败
    exit /b 1
)
echo [SUCCESS] 推送完成

:: 9. 切回 main 分支
echo [INFO] 切回 main 分支...
git checkout main

echo.
echo ========================================
echo   发版流程启动成功！
echo ========================================
echo.
echo 版本号: v%VERSION%
echo 分支:   %BRANCH_NAME%
echo.
echo 接下来请：
echo   1. 前往 GitHub Actions 查看构建进度
echo      https://github.com/en-o/codeshelf/actions
echo.
echo   2. 构建完成后，前往 Releases 页面发布
echo      https://github.com/en-o/codeshelf/releases
echo.
echo   3. 发布后可合并回 main 分支：
echo      git merge %BRANCH_NAME%
echo      git push origin main
echo.

endlocal
