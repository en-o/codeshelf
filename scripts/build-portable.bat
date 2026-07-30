@echo off
chcp 65001 >nul 2>&1
setlocal

:: CodeShelf 便携版构建脚本
:: 先构建，再打包成绿色版

cd /d "%~dp0.."

echo [1/3] 构建应用...
call npm run tauri build
if errorlevel 1 (
    echo 构建失败
    exit /b 1
)

echo [2/3] 创建便携版...
for /f "tokens=*" %%i in ('node -e "console.log(require('./src-tauri/tauri.conf.json').version)"') do set VERSION=%%i

set PORTABLE_DIR=CodeShelf-Portable-v%VERSION%
set ZIP_NAME=CodeShelf-Portable-v%VERSION%-x64.zip

if exist "%PORTABLE_DIR%" rd /s /q "%PORTABLE_DIR%"
mkdir "%PORTABLE_DIR%"

:: 复制可执行文件
copy "src-tauri\target\release\CodeShelf.exe" "%PORTABLE_DIR%\"

:: 复制 sidecar：布局必须与安装版一致（exe 旁边一个 sidecars\ 目录），
:: 否则简历生成会报「未找到内置 Node resume agent」
if not exist "src-tauri\resources\sidecars\node\node.exe" (
    echo 错误：sidecar 产物缺失，请先运行 npm run resume-agent:prepare-sidecar
    exit /b 1
)
if not exist "src-tauri\resources\sidecars\resume-agent\main.cjs" (
    echo 错误：sidecar 产物缺失，请先运行 npm run resume-agent:prepare-sidecar
    exit /b 1
)
xcopy /e /i /y "src-tauri\resources\sidecars" "%PORTABLE_DIR%\sidecars" >nul

:: 创建便携版标记
echo This is a portable version. Auto-update is disabled. > "%PORTABLE_DIR%\.portable"

echo [3/3] 打包 ZIP...
if exist "%ZIP_NAME%" del "%ZIP_NAME%"
powershell -Command "Compress-Archive -Path '%PORTABLE_DIR%\*' -DestinationPath '%ZIP_NAME%'"

echo.
echo ========================================
echo   便携版构建完成！
echo ========================================
echo.
echo 文件: %ZIP_NAME%
echo.

:: 清理临时目录
rd /s /q "%PORTABLE_DIR%"

endlocal
