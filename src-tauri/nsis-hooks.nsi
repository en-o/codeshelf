; NSIS Installer Hooks for CodeShelf
; This script handles installation customizations

; Helper function to check if path ends with product name
!macro CheckAndAppendProductName
  ; Get the last directory component of INSTDIR
  Push $0
  Push $1

  StrCpy $0 $INSTDIR
  ; Get string length
  StrLen $1 $0

  ; Check if INSTDIR already ends with product name
  StrCpy $1 $0 "" -10  ; Get last 10 chars (length of "CodeShelf")
  StrCmp $1 "CodeShelf" +3 0
  StrCmp $1 "codeshelf" +2 0
  ; Path doesn't end with product name, append it
  StrCpy $INSTDIR "$INSTDIR\${PRODUCTNAME}"

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
