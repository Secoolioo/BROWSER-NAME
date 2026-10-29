; Customizations of the NSIS installer and uninstaller that electron-builder generates.

; Finds the browser of the current user (of every user for per-machine installations) by its
; program name: exit code 0 when it runs.
!macro astelaFindBrowser _RETURN
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  !else
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  !endif
  Pop ${_RETURN}
!macroend

; Asks the browser and its helper processes to close; with /F, stops them.
!macro astelaStopBrowser _FORCE
  Push $0
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill ${_FORCE} /T /IM "${APP_EXECUTABLE_FILENAME}"`
  !else
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill ${_FORCE} /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  !endif
  Pop $0 ; the exit code
  Pop $0
!macroend

; Replaces electron-builder's check for a running browser. That check starts PowerShell and
; queries WMI, which can take minutes or never return on a fresh system and is often
; restricted in companies; tasklist and taskkill need neither. The installer and uninstaller
; never carry the browser's program name, so they cannot stop themselves.
!macro customCheckAppRunning
  !insertmacro astelaFindBrowser $R0
  ${if} $R0 == 0
    ; An update starts the installer while the browser quits; it closes without asking.
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK astelaStop
      Quit
    ${endIf}
    astelaStop:
    DetailPrint "$(appClosing)"
    !insertmacro astelaStopBrowser ""
    StrCpy $R1 0
    astelaWait:
      Sleep 1000
      IntOp $R1 $R1 + 1
      !insertmacro astelaFindBrowser $R0
      ${if} $R0 == 0
        ${if} $R1 = 3
          !insertmacro astelaStopBrowser "/F"
        ${elseif} $R1 >= 10
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY astelaStop
          Quit
        ${endIf}
        Goto astelaWait
      ${endIf}
  ${endIf}
!macroend
