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

:: 验证版本号格式。
::
:: 原来只用 `for /f delims=.` 检查「有没有第三段」，`1.2.foo`、`1.2.3.4` 都能通过，
:: 然后这些非法值会被写进 package.json / tauri.conf.json / Cargo.toml 五个文件。
:: 改用与 scripts/release.sh **完全相同**的正则，且在改写任何文件之前完成校验。
node -e "process.exit(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(process.argv[1]) ? 0 : 1)" "%VERSION%"
if errorlevel 1 (
    echo [ERROR] 版本号格式无效: %VERSION% ^(应为 x.y.z 格式，如 0.2.0^)
    exit /b 1
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

:: 检查当前是否在 main 分支
for /f "tokens=*" %%a in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%a
if not "%CURRENT_BRANCH%"=="main" (
    echo [ERROR] 当前分支是 %CURRENT_BRANCH%，请在 main 分支上运行此脚本
    exit /b 1
)

:: 工作树与暂存区必须干净（与 release.sh 一致）。
:: 脚本只 git add 五个版本文件，但 git commit 会把**所有** staged 内容一并提交；
:: 未暂存的改动则参与了本地验证却进不了 release，两边代码对不上。
for /f "tokens=*" %%a in ('git status --porcelain') do (
    echo.
    git status --short
    echo.
    echo [ERROR] 工作树/暂存区不干净^(见上^)。发版必须从确定的源码开始：请先提交或 stash。
    exit /b 1
)

:: 基线必须与远程一致
echo [INFO] 校验 main 与 origin/main 是否同步...
git fetch origin main --quiet
if errorlevel 1 (
    echo [ERROR] 无法 fetch origin/main，请检查网络或远程配置
    exit /b 1
)
for /f "tokens=*" %%a in ('git rev-parse HEAD') do set LOCAL_SHA=%%a
for /f "tokens=*" %%a in ('git rev-parse origin/main') do set REMOTE_SHA=%%a
for /f "tokens=*" %%a in ('git merge-base HEAD origin/main') do set BASE_SHA=%%a
if not "%LOCAL_SHA%"=="%REMOTE_SHA%" (
    if "%LOCAL_SHA%"=="%BASE_SHA%" (
        echo [ERROR] 本地 main 落后于 origin/main，请先 git pull
    ) else if "%REMOTE_SHA%"=="%BASE_SHA%" (
        echo [ERROR] 本地 main 领先于 origin/main^(有未推送的提交^)，请先 git push
    ) else (
        echo [ERROR] 本地 main 与 origin/main 已分叉，请先处理后再发版
    )
    exit /b 1
)
echo [SUCCESS] 基线一致: %LOCAL_SHA%

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
    call npm install --package-lock-only --ignore-scripts --silent 2>nul
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

:: 提交内容必须可预测：开工前已确认工作树干净，此刻 staged 的应恰好是这五个文件
node -e "const {execSync}=require('child_process');const expected=['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock'];const staged=execSync('git diff --cached --name-only').toString().split('\n').map(s=>s.trim()).filter(Boolean);const extra=staged.filter(f=>!expected.includes(f));if(extra.length){console.error('非版本文件混入暂存区: '+extra.join(', '));process.exit(1)}console.log('本次发版提交将包含:');staged.forEach(f=>console.log('    '+f));"
if errorlevel 1 (
    echo [ERROR] 暂存区出现了非版本文件，已中止。发版提交只应包含版本号改动。
    exit /b 1
)
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

:: 8. 创建 release 分支
echo [INFO] 创建分支 %BRANCH_NAME%...
git checkout -b "%BRANCH_NAME%"
if errorlevel 1 (
    echo [ERROR] 创建分支失败
    exit /b 1
)
echo [SUCCESS] 分支创建完成

:: 9. 推送到远程
echo [INFO] 推送到远程 origin/%BRANCH_NAME%...
git push origin "%BRANCH_NAME%"
if errorlevel 1 (
    echo [ERROR] 推送失败
    exit /b 1
)
echo [SUCCESS] 推送完成

:: 10. 切回 main 分支
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
