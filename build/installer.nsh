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
  Var /GLOBAL echoInstallRootCanOwn

  Function EchoNormalizeInstallDirectory
    !insertmacro EchoReadCommandFlag "updated" $R2
    ${If} $R2 == "1"
      Return
    ${EndIf}

    StrCpy $echoInstallRootCanOwn "0"
    ${GetFileName} "$INSTDIR" $R0
    ${If} $R0 != "${APP_FILENAME}"
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}

    echoCheckInstallRoot:
    ${If} ${FileExists} "$INSTDIR\.echo-install-root"
      StrCpy $echoInstallRootCanOwn "1"
      Return
    ${EndIf}

    ; A legacy ECHO installation remains usable, but is not retroactively
    ; marked as safe for whole-directory deletion.
    ${If} ${FileExists} "$INSTDIR\${APP_FILENAME}.exe"
      Return
    ${EndIf}

    ${If} ${FileExists} "$INSTDIR\*.*"
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      Goto echoCheckInstallRoot
    ${EndIf}

    StrCpy $echoInstallRootCanOwn "1"
  FunctionEnd

  Function EchoInstallOptionsPageCreate
    ${If} ${Silent}
      Abort
    ${EndIf}
    !insertmacro EchoReadCommandFlag "updated" $R2
    ${If} $R2 == "1"
      Abort
    ${EndIf}
    Call EchoNormalizeInstallDirectory

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

    ${NSD_CreateLabel} 0 54u 100% 22u "开始菜单快捷方式仍会正常创建。桌面快捷方式只是额外入口，之后也可以手动删除。"
    Pop $0

    ${NSD_CreateLabel} 0 80u 100% 24u "实际安装目录：$INSTDIR"
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
    StrCpy $echoInstallRootCanOwn "0"
    Call EchoNormalizeInstallDirectory
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

    !insertmacro EchoReadCommandFlag "updated" $R2
    ${If} $R2 != "1"
      ${If} $echoInstallRootCanOwn == "1"
        ClearErrors
        FileOpen $R4 "$INSTDIR\.echo-install-root" w
        ${IfNot} ${Errors}
          FileWrite $R4 "app.echo.next install root v1"
          FileClose $R4
        ${EndIf}
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

    ${NSD_CreateRadioButton} 0 64u 100% 12u "删除设置、媒体库、插件、应用内备份、缓存和登录信息"
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

  !macro echoRemoveRecordedExternalCoverCache
    ClearErrors
    FileOpen $R4 "$APPDATA\${APP_FILENAME}\.echo-external-cover-cache-root.txt" r
    ${IfNot} ${Errors}
      FileReadUTF16LE $R4 $R5
      FileClose $R4
      ${If} $R5 != ""
        ${If} ${FileExists} "$R5\.echo-cover-cache-root.json"
          DetailPrint "Deleting the ECHO-owned external cover cache: $R5"
          RMDir /r /REBOOTOK "$R5"
          ${If} ${FileExists} "$R5\*.*"
            DetailPrint "Some external cache entries are locked or too deep; Windows will retry removal after reboot."
          ${Else}
            Delete "$APPDATA\${APP_FILENAME}\.echo-external-cover-cache-root.txt"
          ${EndIf}
        ${Else}
          DetailPrint "Skipped external cache cleanup because the ECHO ownership marker is missing."
          Delete "$APPDATA\${APP_FILENAME}\.echo-external-cover-cache-root.txt"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend

  !macro echoRemoveCurrentUserCache
    DetailPrint "Deleting ECHO NEXT cache and temporary data for the current Windows user."
    !insertmacro echoRemoveRecordedExternalCoverCache
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\Cache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\Code Cache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\GPUCache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\DawnCache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\DawnGraphiteCache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\DawnWebGPUCache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\ShaderCache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\cover-cache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\artist-images"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\remote-cover-cache"
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}\smtc-covers"

    !ifdef APP_PRODUCT_FILENAME
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\Cache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\Code Cache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\GPUCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\DawnCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\DawnGraphiteCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\DawnWebGPUCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\ShaderCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\cover-cache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\artist-images"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\remote-cover-cache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}\smtc-covers"
    !endif

    !ifdef APP_PACKAGE_NAME
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\Cache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\Code Cache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\GPUCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\DawnCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\DawnGraphiteCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\DawnWebGPUCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\ShaderCache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\cover-cache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\artist-images"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\remote-cover-cache"
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}\smtc-covers"
      RMDir /r /REBOOTOK "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif

    RMDir /r /REBOOTOK "$LOCALAPPDATA\echo-next-updater"
  !macroend

  !macro echoRemoveCurrentUserProfile
    DetailPrint "Deleting ECHO NEXT settings, library database, and login data for the current Windows user."
    !insertmacro echoRemoveRecordedExternalCoverCache
    RMDir /r /REBOOTOK "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r /REBOOTOK "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}"
    !endif

    RMDir /r /REBOOTOK "$APPDATA\ECHO NEXT"
    RMDir /r /REBOOTOK "$APPDATA\ECHO Next"
    RMDir /r /REBOOTOK "$APPDATA\echo-next"
    RMDir /r /REBOOTOK "$LOCALAPPDATA\ECHO NEXT"
    RMDir /r /REBOOTOK "$LOCALAPPDATA\ECHO Next"
    RMDir /r /REBOOTOK "$LOCALAPPDATA\echo-next"
  !macroend

  !macro echoRemoveAllEchoData
    DetailPrint "Deleting all known ECHO data for the current Windows user."
    !insertmacro echoRemoveCurrentUserProfile
    !ifdef APP_PACKAGE_NAME
      RMDir /r /REBOOTOK "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif
    StrCpy $R5 "0"
    IfFileExists "$APPDATA\ECHO\echo-settings.json" 0 +2
      StrCpy $R5 "1"
    IfFileExists "$APPDATA\ECHO\echo-library.sqlite" 0 +2
      StrCpy $R5 "1"
    ${If} $R5 == "1"
      RMDir /r /REBOOTOK "$APPDATA\ECHO"
    ${Else}
      DetailPrint "Skipped legacy APPDATA\\ECHO because no ECHO profile marker was found."
    ${EndIf}
    RMDir /r /REBOOTOK "$LOCALAPPDATA\echo-next-updater"
    StrCpy $R5 "0"
    IfFileExists "$LOCALAPPDATA\ECHO\echo-settings.json" 0 +2
      StrCpy $R5 "1"
    IfFileExists "$LOCALAPPDATA\ECHO\echo-library.sqlite" 0 +2
      StrCpy $R5 "1"
    ${If} $R5 == "1"
      RMDir /r /REBOOTOK "$LOCALAPPDATA\ECHO"
    ${Else}
      DetailPrint "Skipped legacy LOCALAPPDATA\\ECHO because no ECHO profile marker was found."
    ${EndIf}
  !macroend

  !macro echoRemoveKnownInstallFiles
    SetOutPath $TEMP
    RMDir /r /REBOOTOK "$INSTDIR\locales"
    RMDir /r /REBOOTOK "$INSTDIR\resources"
    Delete /REBOOTOK "$INSTDIR\chrome_100_percent.pak"
    Delete /REBOOTOK "$INSTDIR\chrome_200_percent.pak"
    Delete /REBOOTOK "$INSTDIR\d3dcompiler_47.dll"
    Delete /REBOOTOK "$INSTDIR\dxcompiler.dll"
    Delete /REBOOTOK "$INSTDIR\dxil.dll"
    Delete /REBOOTOK "$INSTDIR\${APP_FILENAME}.exe"
    Delete /REBOOTOK "$INSTDIR\ffmpeg.dll"
    Delete /REBOOTOK "$INSTDIR\icudtl.dat"
    Delete /REBOOTOK "$INSTDIR\libEGL.dll"
    Delete /REBOOTOK "$INSTDIR\libGLESv2.dll"
    Delete /REBOOTOK "$INSTDIR\LICENSE.electron.txt"
    Delete /REBOOTOK "$INSTDIR\LICENSES.chromium.html"
    Delete /REBOOTOK "$INSTDIR\resources.pak"
    Delete /REBOOTOK "$INSTDIR\snapshot_blob.bin"
    Delete /REBOOTOK "$INSTDIR\v8_context_snapshot.bin"
    Delete /REBOOTOK "$INSTDIR\vk_swiftshader.dll"
    Delete /REBOOTOK "$INSTDIR\vk_swiftshader_icd.json"
    Delete /REBOOTOK "$INSTDIR\vulkan-1.dll"
    Delete /REBOOTOK "$INSTDIR\${UNINSTALL_FILENAME}"
    RMDir "$INSTDIR"
  !macroend

  !macro customRemoveFiles
    ${If} ${FileExists} "$INSTDIR\.echo-install-root"
      ${If} ${isUpdated}
        CreateDirectory "$PLUGINSDIR\old-install"
        Push ""
        Call un.atomicRMDir
        Pop $R0
        ${If} $R0 != 0
          DetailPrint "File is busy, aborting: $R0"
          Push ""
          Call un.restoreFiles
          Pop $R0
          Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
        ${EndIf}
      ${EndIf}

      SetOutPath $TEMP
      RMDir /r /REBOOTOK "$INSTDIR"
      ${If} ${isUpdated}
        CreateDirectory "$INSTDIR"
        FileOpen $R4 "$INSTDIR\.echo-install-root" w
        FileWrite $R4 "app.echo.next install root v1"
        FileClose $R4
      ${EndIf}
    ${Else}
      DetailPrint "Install-root ownership marker is missing; removing only known ECHO application files."
      !insertmacro echoRemoveKnownInstallFiles
      ${If} ${FileExists} "$INSTDIR\*.*"
        DetailPrint "Preserved unknown files in the installation directory: $INSTDIR"
      ${EndIf}
    ${EndIf}
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
