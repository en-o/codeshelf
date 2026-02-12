@echo off
chcp 65001 >nul

echo.
echo ========================================
echo   CodeShelf 旧数据查看工具
echo ========================================
echo.

:: 设置可能的旧数据路径
set "OLD_DIR_1=%APPDATA%\com.codeshelf.desktop"
set "OLD_DIR_2=%LOCALAPPDATA%\com.codeshelf.desktop"
set "OLD_DIR_3=%APPDATA%\codeshelf"
set "OLD_DIR_4=%LOCALAPPDATA%\codeshelf"

:: 检查哪些目录存在
echo Checking directories...
echo.
if exist "%OLD_DIR_1%" (echo [Y] %OLD_DIR_1%) else (echo [X] %OLD_DIR_1%)
if exist "%OLD_DIR_2%" (echo [Y] %OLD_DIR_2%) else (echo [X] %OLD_DIR_2%)
if exist "%OLD_DIR_3%" (echo [Y] %OLD_DIR_3%) else (echo [X] %OLD_DIR_3%)
if exist "%OLD_DIR_4%" (echo [Y] %OLD_DIR_4%) else (echo [X] %OLD_DIR_4%)

echo.
echo ========================================
echo   Checking each directory for data
echo ========================================

:: 检查每个存在的目录
call :check_dir "%OLD_DIR_1%"
call :check_dir "%OLD_DIR_2%"
call :check_dir "%OLD_DIR_3%"
call :check_dir "%OLD_DIR_4%"

echo.
echo ========================================
echo.
echo New data location: App Install Dir\data\
echo.

pause
exit /b

:check_dir
set "DIR=%~1"
if not exist "%DIR%" goto :eof

echo.
echo ----------------------------------------
echo DIR: %DIR%
echo ----------------------------------------

:: 列出所有 json 文件
echo.
echo JSON files in this directory:
dir /b "%DIR%\*.json" 2>nul
if errorlevel 1 (
    echo   No json files found
    goto :eof
)

:: 显示项目
if exist "%DIR%\projects.json" (
    echo.
    echo --- Projects ---
    powershell -NoProfile -Command "try{$j=Get-Content '%DIR%\projects.json' -Raw|ConvertFrom-Json;$p=if($j.projects){$j.projects}elseif($j.data){$j.data}else{$j};$p|%%{Write-Host('  '+$_.name+' -> '+$_.path)}}catch{Write-Host '  Parse error'}"
)

:: 显示分类
if exist "%DIR%\categories.json" (
    echo.
    echo --- Categories ---
    powershell -NoProfile -Command "try{$j=Get-Content '%DIR%\categories.json' -Raw|ConvertFrom-Json;$c=if($j.data){$j.data}else{$j};$c|%%{Write-Host('  '+$_)}}catch{Write-Host '  Parse error'}"
)

:: 显示标签
if exist "%DIR%\labels.json" (
    echo.
    echo --- Labels ---
    powershell -NoProfile -Command "try{$j=Get-Content '%DIR%\labels.json' -Raw|ConvertFrom-Json;$l=if($j.data){$j.data}else{$j};$l|%%{Write-Host('  '+$_)}}catch{Write-Host '  Parse error'}"
)

:: 显示编辑器
if exist "%DIR%\editors.json" (
    echo.
    echo --- Editors ---
    powershell -NoProfile -Command "try{$j=Get-Content '%DIR%\editors.json' -Raw|ConvertFrom-Json;$e=if($j.data){$j.data}else{$j};$e|%%{Write-Host('  '+$_.name+' -> '+$_.path)}}catch{Write-Host '  Parse error'}"
)

:: 显示 Claude 配置
if exist "%DIR%\claude_profiles_host.json" (
    echo.
    echo --- Claude Host Profiles ---
    echo   File exists: claude_profiles_host.json
)
if exist "%DIR%\claude_profiles_wsl.json" (
    echo.
    echo --- Claude WSL Profiles ---
    echo   File exists: claude_profiles_wsl.json
)

goto :eof
