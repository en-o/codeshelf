#!/usr/bin/env bash

# 从 SVG 生成所有图标
# 需要 ImageMagick: sudo apt-get install imagemagick

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ICONS_DIR="$(dirname "$SCRIPT_DIR")/src-tauri/icons"

cd "$ICONS_DIR" || exit 1

echo "正在从 SVG 生成图标..."

# 主图标 (256x256) - 强制 RGBA 格式
convert -background none icon.svg -resize 256x256 -depth 8 -define png:color-type=6 PNG32:icon.png
echo "done: icon.png (256x256)"

# 高清图标 (256x256) - 强制 RGBA 格式
convert -background none icon.svg -resize 256x256 -depth 8 -define png:color-type=6 PNG32:128x128@2x.png
echo "done: 128x128@2x.png (256x256 Retina)"

# 标准图标 (128x128) - 强制 RGBA 格式
convert -background none icon.svg -resize 128x128 -depth 8 -define png:color-type=6 PNG32:128x128.png
echo "done: 128x128.png"

# 小图标 (32x32) - 强制 RGBA 格式
convert -background none icon-small.svg -resize 32x32 -depth 8 -define png:color-type=6 PNG32:32x32.png
echo "done: 32x32.png"

# 托盘图标 (32x32, 深色背景不透明)
convert -background "#0a1428" icon-small.svg -resize 32x32 -alpha remove -alpha off -depth 8 tray-icon.png
echo "done: tray-icon.png (托盘图标)"

# Windows ICO (多尺寸)
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 -depth 8 app-icon-circle.ico
echo "done: app-icon-circle.ico (Windows 安装图标)"

echo ""
echo "完成！生成的图标文件："
ls -la *.png *.ico
