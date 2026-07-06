; NSIS Installer Hooks for CodeShelf
; This script handles installation customizations

; Helper function to check if path ends with product name
!macro CheckAndAppendProductName
  Push $0
  Push $1

  ; 动态取产品名长度，取 $INSTDIR 末尾同样长度的子串做比较。
  ; 旧实现硬编码 -10 截取，而 "CodeShelf" 只有 9 个字符，永远不相等，
  ; 导致对已经以产品名结尾的目录反复追加一层，exe 与 resources 从此分处不同层级。
  ; StrCmp 本身大小写不敏感，无需再单独判断小写变体。
  StrLen $0 "${PRODUCTNAME}"
  IntOp $0 0 - $0
  StrCpy $1 $INSTDIR "" $0
  StrCmp $1 "${PRODUCTNAME}" done 0
  ; 末段不是产品名（用户选了裸目录），追加一层，保证资源自包含
  StrCpy $INSTDIR "$INSTDIR\${PRODUCTNAME}"
  done:

  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Auto-append product name to install directory if not present
  !insertmacro CheckAndAppendProductName

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
