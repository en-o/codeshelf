; NSIS Installer Hooks for CodeShelf
; This script ensures desktop shortcuts are properly updated on reinstall

!macro NSIS_HOOK_PREINSTALL
  ; Delete old desktop shortcut to ensure new icon is used
  Delete "$DESKTOP\CodeShelf.lnk"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Refresh shell icon cache
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend
