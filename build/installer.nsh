!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh

!macro EchoReadCommandFlag FLAG OUTPUT
  StrCpy ${OUTPUT} "0"
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--${FLAG}" $R1
  ${IfNot} ${Errors}
    StrCpy ${OUTPUT} "1"
  ${Else}
    ClearErrors
    ${GetOptions} $R0 "/${FLAG}" $R1
    ${IfNot} ${Errors}
      StrCpy ${OUTPUT} "1"
    ${EndIf}
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
  Var /GLOBAL echoCreateDesktopShortcut
  Var /GLOBAL echoCreateDesktopShortcutCheckbox

  Function EchoInstallOptionsPageCreate
    ${If} ${Silent}
      Abort
    ${EndIf}
    !insertmacro EchoReadCommandFlag "updated" $R2
    ${If} $R2 == "1"
      Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 22u "选择安装后要额外启用的项目。"
    Pop $0

    ${NSD_CreateCheckbox} 0 30u 100% 12u "创建桌面快捷方式"
    Pop $echoCreateDesktopShortcutCheckbox
    ${NSD_SetState} $echoCreateDesktopShortcutCheckbox $echoCreateDesktopShortcut

    ${NSD_CreateLabel} 0 54u 100% 36u "开始菜单快捷方式仍会正常创建。桌面快捷方式只是额外入口，之后也可以手动删除。"
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function EchoInstallOptionsPageLeave
    ${NSD_GetState} $echoCreateDesktopShortcutCheckbox $echoCreateDesktopShortcut
  FunctionEnd

  !macro customPageAfterChangeDir
    Page custom EchoInstallOptionsPageCreate EchoInstallOptionsPageLeave
  !macroend

  !macro customInit
    StrCpy $echoCreateDesktopShortcut "${BST_UNCHECKED}"
  !macroend

  !macro customInstall
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--create-desktop-shortcut" $R1
    ${IfNot} ${Errors}
      StrCpy $echoCreateDesktopShortcut "${BST_CHECKED}"
    ${EndIf}

    ${If} $echoCreateDesktopShortcut == "${BST_CHECKED}"
      !insertmacro EchoReadCommandFlag "updated" $R2
      ${If} $R2 != "1"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\uninstallerIcon.ico" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
        DetailPrint "Created ECHO desktop shortcut."
      ${EndIf}
    ${EndIf}
  !macroend
!else
  Var /GLOBAL echoUninstallDataMode
  Var /GLOBAL echoKeepDataRadio
  Var /GLOBAL echoDeleteCacheRadio
  Var /GLOBAL echoDeleteProfileRadio
  Var /GLOBAL echoDeleteAllDataRadio

  Function un.EchoDataOptionsPageCreate
    ${If} ${Silent}
      Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 20u "选择卸载时要清理的数据。默认只移除程序文件。"
    Pop $0

    ${NSD_CreateRadioButton} 0 28u 100% 12u "只卸载程序，保留媒体库、设置、缓存和登录信息"
    Pop $echoKeepDataRadio

    ${NSD_CreateRadioButton} 0 46u 100% 12u "删除缓存和临时文件"
    Pop $echoDeleteCacheRadio

    ${NSD_CreateRadioButton} 0 64u 100% 12u "删除设置、媒体库数据库和登录信息"
    Pop $echoDeleteProfileRadio

    ${NSD_CreateRadioButton} 0 82u 100% 12u "删除全部 ECHO 数据（包括旧版数据和更新器缓存）"
    Pop $echoDeleteAllDataRadio

    ${NSD_CreateLabel} 0 104u 100% 28u "以上选项都不会删除你的本地音乐文件。若不确定，请保留默认选项。"
    Pop $0

    ${If} $echoUninstallDataMode == "cache"
      ${NSD_SetState} $echoDeleteCacheRadio ${BST_CHECKED}
    ${ElseIf} $echoUninstallDataMode == "profile"
      ${NSD_SetState} $echoDeleteProfileRadio ${BST_CHECKED}
    ${ElseIf} $echoUninstallDataMode == "all"
      ${NSD_SetState} $echoDeleteAllDataRadio ${BST_CHECKED}
    ${Else}
      ${NSD_SetState} $echoKeepDataRadio ${BST_CHECKED}
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function un.EchoDataOptionsPageLeave
    ${NSD_GetState} $echoDeleteAllDataRadio $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $echoUninstallDataMode "all"
      Return
    ${EndIf}

    ${NSD_GetState} $echoDeleteProfileRadio $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $echoUninstallDataMode "profile"
      Return
    ${EndIf}

    ${NSD_GetState} $echoDeleteCacheRadio $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $echoUninstallDataMode "cache"
      Return
    ${EndIf}

    StrCpy $echoUninstallDataMode "keep"
  FunctionEnd

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.EchoDataOptionsPageCreate un.EchoDataOptionsPageLeave
  !macroend

  !macro customUnInit
    StrCpy $echoUninstallDataMode "keep"
  !macroend

  !macro echoRemoveCurrentUserCache
    DetailPrint "Deleting ECHO NEXT cache and temporary data for the current Windows user."
    RMDir /r "$APPDATA\${APP_FILENAME}\Cache"
    RMDir /r "$APPDATA\${APP_FILENAME}\Code Cache"
    RMDir /r "$APPDATA\${APP_FILENAME}\GPUCache"
    RMDir /r "$APPDATA\${APP_FILENAME}\DawnCache"
    RMDir /r "$APPDATA\${APP_FILENAME}\DawnGraphiteCache"
    RMDir /r "$APPDATA\${APP_FILENAME}\DawnWebGPUCache"
    RMDir /r "$APPDATA\${APP_FILENAME}\ShaderCache"
    RMDir /r "$APPDATA\${APP_FILENAME}\cover-cache"
    RMDir /r "$APPDATA\${APP_FILENAME}\artist-images"
    RMDir /r "$APPDATA\${APP_FILENAME}\remote-cover-cache"
    RMDir /r "$APPDATA\${APP_FILENAME}\smtc-covers"

    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\Cache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\Code Cache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\GPUCache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\DawnCache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\DawnGraphiteCache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\DawnWebGPUCache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\ShaderCache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\cover-cache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\artist-images"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\remote-cover-cache"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}\smtc-covers"
    !endif

    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\Cache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\Code Cache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\GPUCache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\DawnCache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\DawnGraphiteCache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\DawnWebGPUCache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\ShaderCache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\cover-cache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\artist-images"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\remote-cover-cache"
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\smtc-covers"
      RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif

    RMDir /r "$LOCALAPPDATA\echo-next-updater"
  !macroend

  !macro echoRemoveCurrentUserProfile
    DetailPrint "Deleting ECHO NEXT settings, library database, and login data for the current Windows user."
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif

    RMDir /r "$APPDATA\ECHO NEXT"
    RMDir /r "$APPDATA\ECHO Next"
    RMDir /r "$APPDATA\echo-next"
    RMDir /r "$LOCALAPPDATA\ECHO NEXT"
    RMDir /r "$LOCALAPPDATA\ECHO Next"
    RMDir /r "$LOCALAPPDATA\echo-next"
  !macroend

  !macro echoRemoveAllEchoData
    DetailPrint "Deleting all known ECHO data for the current Windows user."
    !insertmacro echoRemoveCurrentUserProfile
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif
    RMDir /r "$APPDATA\ECHO"
    RMDir /r "$LOCALAPPDATA\echo-next-updater"
    RMDir /r "$LOCALAPPDATA\ECHO"
  !macroend

  !macro customUnInstall
    !insertmacro EchoReadCommandFlag "updated" $R2
    !insertmacro EchoReadCommandFlag "keep-shortcuts" $R3
    ${If} $R2 != "1"
      ${If} $R3 != "1"
        WinShell::UninstShortcut "$oldDesktopLink"
        Delete "$oldDesktopLink"
        ${If} $oldDesktopLink != $newDesktopLink
          WinShell::UninstShortcut "$newDesktopLink"
          Delete "$newDesktopLink"
        ${EndIf}
      ${EndIf}
    ${EndIf}

    ClearErrors
    ${GetParameters} $R0

    ClearErrors
    ${GetOptions} $R0 "--delete-cache" $R1
    ${IfNot} ${Errors}
      StrCpy $echoUninstallDataMode "cache"
    ${EndIf}

    ClearErrors
    ${GetOptions} $R0 "--delete-profile" $R1
    ${IfNot} ${Errors}
      StrCpy $echoUninstallDataMode "profile"
    ${EndIf}

    ClearErrors
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${IfNot} ${Errors}
      StrCpy $echoUninstallDataMode "all"
    ${EndIf}

    ClearErrors
    ${GetOptions} $R0 "--delete-all-data" $R1
    ${IfNot} ${Errors}
      StrCpy $echoUninstallDataMode "all"
    ${EndIf}

    !insertmacro EchoReadCommandFlag "updated" $R2
    ${If} $R2 != "1"
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}

      ${If} $echoUninstallDataMode == "cache"
        !insertmacro echoRemoveCurrentUserCache
      ${ElseIf} $echoUninstallDataMode == "profile"
        !insertmacro echoRemoveCurrentUserProfile
      ${ElseIf} $echoUninstallDataMode == "all"
        !insertmacro echoRemoveAllEchoData
      ${EndIf}

      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif
