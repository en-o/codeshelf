# CodeShelf Old Data Extractor
# 从 WebView localStorage (LevelDB) 中提取旧数据

$leveldbDir = "$env:LOCALAPPDATA\com.codeshelf.desktop\EBWebView\Default\Local Storage\leveldb"

Write-Host ""
Write-Host "========================================"
Write-Host "  CodeShelf Old Data Viewer"
Write-Host "========================================"
Write-Host ""

# 检查目录
Write-Host "Data location: $leveldbDir"
Write-Host ""

if (-not (Test-Path $leveldbDir)) {
    Write-Host "[X] localStorage directory not found!"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit
}

Write-Host "[Y] localStorage directory found"
Write-Host ""
Write-Host "========================================"
Write-Host "  Extracting Data"
Write-Host "========================================"
Write-Host ""

# 读取所有 LevelDB 文件内容
$content = ""
$files = Get-ChildItem $leveldbDir -File | Where-Object { $_.Extension -in '.log', '.ldb', '' }

foreach ($f in $files) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        $content += $text
    } catch {}
}

# 提取分类
Write-Host "=== Categories ==="
if ($content -match '"categories"\s*:\s*\[([^\]]*)\]') {
    $cats = $matches[1] -split ',' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ -and $_ -ne '' }
    if ($cats) {
        $cats | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  (empty)"
    }
} else {
    Write-Host "  (not found)"
}

# 提取标签
Write-Host ""
Write-Host "=== Labels ==="
# 查找 labels 数组（排除嵌套在 projects 里的 labels）
if ($content -match '"labels"\s*:\s*\["([^"]*)"(?:\s*,\s*"([^"]*)")*\]') {
    $labelMatches = [regex]::Matches($content, '"labels"\s*:\s*\[([^\]]*)\]')
    foreach ($m in $labelMatches) {
        $labelContent = $m.Groups[1].Value
        # 只处理看起来像全局标签的（包含多个标签且不是空的）
        if ($labelContent -match '^"[^"]+"\s*(,\s*"[^"]+"\s*)+$') {
            $labels = $labelContent -split ',' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ }
            $labels | ForEach-Object { Write-Host "  $_" }
            break
        }
    }
} else {
    Write-Host "  (not found)"
}

# 提取编辑器
Write-Host ""
Write-Host "=== Editors ==="
if ($content -match '"editors"\s*:\s*\[(\{[^\]]*\})\]') {
    try {
        $editorsJson = '[' + $matches[1] + ']'
        $editors = $editorsJson | ConvertFrom-Json -ErrorAction Stop
        if ($editors) {
            $editors | ForEach-Object {
                Write-Host "  $($_.name) -> $($_.path)"
            }
        } else {
            Write-Host "  (empty)"
        }
    } catch {
        Write-Host "  (parse error)"
    }
} else {
    Write-Host "  (not found)"
}

# 提取项目路径
Write-Host ""
Write-Host "=== Project Paths ==="
$pathMatches = [regex]::Matches($content, '"path"\s*:\s*"([^"]+)"')
$paths = $pathMatches | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique | Where-Object { $_ -match '^[A-Za-z]:' -or $_ -match '^/' }
if ($paths) {
    $paths | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "  (not found)"
}

Write-Host ""
Write-Host "========================================"
Write-Host ""
Write-Host "New data location: <App Install Dir>\data\"
Write-Host ""

Read-Host "Press Enter to exit"
