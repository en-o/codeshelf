@echo off
:: CodeShelf Old Data Extractor
:: Run the PowerShell script

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract_old_data.ps1"
