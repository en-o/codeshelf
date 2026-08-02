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

:: 前置校验全部交给 scripts\release-precheck.mjs：
:: 版本号格式、git 仓库、分支、工作树干净、基线（落后/分叉拦，仅发版提交可领先）、
:: release 分支占用。**与 release.sh 共用同一份实现**。
::
:: 这些判定原先在 .bat 里用 for /f 又写了一遍，结果和 .sh 漂移：
:: sh 改成「只允许发版提交领先」「只 add 存在的文件」之后 bat 没跟上，
:: 于是同样的仓库状态在 Windows 上报错、在 macOS 上正常。
:: batch 的 for /f 处理 git 输出也很脆（引号、特殊字符、延迟展开）。
set BRANCH_NAME=release/%VERSION%

node scripts\release-precheck.mjs baseline %VERSION%
if errorlevel 1 exit /b 1
echo [SUCCESS] 前置校验通过

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
:: 只 add **确实存在**的文件：上面对缺失的 lock 文件是「warn 并跳过」，
:: 无条件 add 一个不存在的路径会让 git add 直接失败，两处行为对不上。
for %%f in (package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock) do (
    if exist "%%f" git add "%%f"
)

:: 提交内容必须可预测：开工前已确认工作树干净，此刻 staged 的应恰好是这五个文件
node scripts\release-precheck.mjs verify-staged
if errorlevel 1 exit /b 1
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
