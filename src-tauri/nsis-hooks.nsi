; NSIS Installer Hooks for CodeShelf
; This script handles installation customizations
;
; 注意：不要再往 $INSTDIR 追加产品名。Tauri 的 NSIS 默认已装到 $LOCALAPPDATA\CodeShelf
; （自带产品名一层），任何"末段不是产品名就补一层"的逻辑都会在每次升级时对
; 已存在的 CodeShelf 目录再套一层，导致 CodeShelf\CodeShelf\CodeShelf 越来越深，
; 而数据(data\)跟着 exe 走，于是老数据被留在上一层、表现为"更新后数据丢失"。

!macro NSIS_HOOK_PREINSTALL
  ; Delete old desktop shortcut to ensure new icon is used
  Delete "$DESKTOP\CodeShelf.lnk"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"

  ; Delete old start menu shortcuts
  RMDir /r "$SMPROGRAMS\${PRODUCTNAME}"

  ; Delete old taskbar pinned shortcut (if exists)
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\CodeShelf.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Force refresh shell icon cache
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'

  ; Additional icon cache refresh for Windows 10/11
  ; Clear icon cache database
  nsExec::ExecToLog 'ie4uinit.exe -show'

  ; Notify shell of icon change
  System::Call 'shell32::SHChangeNotify(i 0x00000008, i 0x0000, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 右键菜单由应用设置页按需写入 HKCU。卸载时无论当前开关状态如何都清理，
  ; 避免 command 永久指向已被删除的 CodeShelf.exe。
  DeleteRegKey HKCU "Software\Classes\Directory\shell\CodeShelf"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\CodeShelf"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend
