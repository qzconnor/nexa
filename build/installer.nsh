; Registers the `nx` command (user PATH + App Paths for the Explorer address bar) and removes it
; again on uninstall. nx.exe does the registry work itself, see src/launcher/nx.cs.

!macro customInstall
  ExecWait '"$INSTDIR\bin\nx.exe" --nx-register'
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first; the new version registers again right after.
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\bin\nx.exe" --nx-unregister'
  ${endIf}
!macroend
