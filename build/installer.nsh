!ifdef BUILD_UNINSTALLER
  !include LogicLib.nsh
  !include FileFunc.nsh
  !include nsDialogs.nsh

  Var /GLOBAL echoDeleteAllData
  Var /GLOBAL echoDeleteAllDataCheckbox

  Function un.EchoDeleteAllDataPageCreate
    ${If} ${Silent}
      Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 30u "默认卸载只移除程序文件，保留媒体库、设置、缓存和登录信息。"
    Pop $0

    ${NSD_CreateCheckbox} 0 40u 100% 12u "删除当前用户的所有 ECHO NEXT 数据"
    Pop $echoDeleteAllDataCheckbox
    ${NSD_SetState} $echoDeleteAllDataCheckbox ${BST_UNCHECKED}

    ${NSD_CreateLabel} 0 62u 100% 44u "勾选后会删除 Roaming\ECHO NEXT、旧版 ECHO 数据目录和 LocalAppData\echo-next-updater。不会删除你的音乐文件。"
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function un.EchoDeleteAllDataPageLeave
    ${NSD_GetState} $echoDeleteAllDataCheckbox $echoDeleteAllData
  FunctionEnd

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.EchoDeleteAllDataPageCreate un.EchoDeleteAllDataPageLeave
  !macroend

  !macro customUnInit
    StrCpy $echoDeleteAllData "0"
  !macroend

  !macro echoRemoveCurrentUserData
    DetailPrint "Deleting ECHO NEXT user data for the current Windows user."
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif

    RMDir /r "$APPDATA\ECHO NEXT"
    RMDir /r "$APPDATA\ECHO Next"
    RMDir /r "$APPDATA\echo-next"
    RMDir /r "$APPDATA\ECHO"
    RMDir /r "$LOCALAPPDATA\ECHO NEXT"
    RMDir /r "$LOCALAPPDATA\ECHO Next"
    RMDir /r "$LOCALAPPDATA\echo-next"
    RMDir /r "$LOCALAPPDATA\echo-next-updater"
    RMDir /r "$LOCALAPPDATA\ECHO"
  !macroend

  !macro customUnInstall
    ClearErrors
    ${GetParameters} $R0

    ClearErrors
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${IfNot} ${Errors}
      StrCpy $echoDeleteAllData "${BST_CHECKED}"
    ${EndIf}

    ClearErrors
    ${GetOptions} $R0 "--delete-all-data" $R1
    ${IfNot} ${Errors}
      StrCpy $echoDeleteAllData "${BST_CHECKED}"
    ${EndIf}

    ${If} $echoDeleteAllData == "${BST_CHECKED}"
    ${AndIfNot} ${isUpdated}
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}

      !insertmacro echoRemoveCurrentUserData

      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif
