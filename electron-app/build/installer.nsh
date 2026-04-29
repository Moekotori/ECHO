!macro customInstall
  IfFileExists "$INSTDIR\resources\software.ico" 0 +3
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$INSTDIR\resources\software.ico" 0 "" "" "${APP_DESCRIPTION}"
!macroend
