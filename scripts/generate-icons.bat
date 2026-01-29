@echo off
chcp 65001 >nul 2>&1

:: 生成不透明版本的图标（单独文件）
:: 原图保持不变
:: 需要 ImageMagick: winget install ImageMagick.ImageMagick

cd /d "%~dp0..\src-tauri\icons"

echo 正在生成不透明图标...

:: 托盘图标 (32x32 白色背景)
magick 32x32.png -background white -alpha remove -alpha off tray-icon.png
echo done: tray-icon.png (托盘图标)

:: 安装应用图标 (ico 白色背景)
magick icon.png -background white -alpha remove -alpha off icon-solid.png
magick icon-solid.png -define icon:auto-resize=256,128,64,48,32,16 app-icon.ico
echo done: app-icon.ico (安装图标)

echo.
echo 完成！生成的新文件：
echo   - tray-icon.png  (托盘用)
echo   - app-icon.ico   (安装图标用)
echo.
echo 原图标保持不变
