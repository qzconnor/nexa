; Registers the `nx` command (user PATH + App Paths for the Explorer address bar) and removes it
; again on uninstall. nx.exe does the registry work itself, see src/launcher/nx.cs.
; The uninstaller also removes the start with Windows (src/main/lib/login-item.ts), which the app
; registers under its AppUserModelId.

!macro customInstall
  ExecWait '"$INSTDIR\bin\nx.exe" --nx-register'
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first; the new version registers again right after.
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\bin\nx.exe" --nx-unregister'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "local.nexa"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "local.nexa"
  ${endIf}
!macroend
