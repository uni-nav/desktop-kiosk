!macro _KillProcessByName PROCESS_NAME
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::ExecToLog `taskkill /F /T /IM "${PROCESS_NAME}"`
  !else
    nsExec::ExecToLog `%SYSTEMROOT%\System32\cmd.exe /c taskkill /F /T /IM "${PROCESS_NAME}" /FI "USERNAME eq %USERNAME%"`
  !endif
!macroend

!macro _ClearStartupEntries
  DetailPrint "Cleaning kiosk auto-start registry entries..."
  nsExec::ExecToLog `%SYSTEMROOT%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference='SilentlyContinue'; $$runPaths=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'); $$names=@('Universitet Kiosk','university-kiosk','${APP_EXECUTABLE_FILENAME}','University Kiosk'); foreach($$p in $$runPaths){ foreach($$n in $$names){ Remove-ItemProperty -Path $$p -Name $$n -ErrorAction SilentlyContinue } }"`
!macroend

!macro _RequestInAppMaintenance MODE_FLAG
  DetailPrint "Requesting in-app maintenance mode: ${MODE_FLAG}"
  nsExec::ExecToLog `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" ${MODE_FLAG}`
  Sleep 1400
!macroend

!macro _StopKnownKioskProcesses
  ; Main executable names (current + legacy)
  !insertmacro _KillProcessByName "${APP_EXECUTABLE_FILENAME}"
  !insertmacro _KillProcessByName "Universitet Kiosk.exe"
  !insertmacro _KillProcessByName "University Kiosk.exe"
  !insertmacro _KillProcessByName "university-kiosk.exe"

  ; Electron helper process that can keep lock handles
  !insertmacro _KillProcessByName "crashpad_handler.exe"

  ; Extra safety: kill any process launched from the install directory
  nsExec::ExecToLog `%SYSTEMROOT%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference='SilentlyContinue'; if (Test-Path -LiteralPath '$INSTDIR') { $$target=(Resolve-Path -LiteralPath '$INSTDIR').Path; Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$target, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }"`
!macroend

!macro _TryDisableAssignedAccess
  DetailPrint "Trying to disable Assigned Access/Kiosk shell temporarily..."
  nsExec::ExecToLog `%SYSTEMROOT%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference='SilentlyContinue'; if (Get-Command Clear-AssignedAccess -ErrorAction SilentlyContinue) { Clear-AssignedAccess }; Stop-Service -Name AssignedAccessManagerSvc -Force -ErrorAction SilentlyContinue; Set-Service -Name AssignedAccessManagerSvc -StartupType Manual -ErrorAction SilentlyContinue"`
!macroend

!macro customCheckAppRunning
  DetailPrint "Stopping old kiosk process tree..."
  !insertmacro _RequestInAppMaintenance "--prepare-update"
  !insertmacro _ClearStartupEntries
  !insertmacro _StopKnownKioskProcesses
  Sleep 1500

  ; Verify main app process is really closed, otherwise fail fast with a clear reason
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    DetailPrint "App still running. Retrying force kill..."
    !insertmacro _StopKnownKioskProcesses
    Sleep 1000
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      !insertmacro _TryDisableAssignedAccess
      !insertmacro _ClearStartupEntries
      !insertmacro _StopKnownKioskProcesses
      Sleep 1500
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        MessageBox MB_ICONSTOP|MB_OK "Installer ilovani yopa olmadi.$\r$\nKiosk shell (Assigned Access) processni qayta ishga tushiryapti.$\r$\nAdmin hisobdan Assigned Access ni vaqtincha o'chirib, update/uninstall ni qayta ishga tushiring."
        Abort
      ${endif}
    ${endif}
  ${endif}
!macroend

!macro customUnInstall
  DetailPrint "Preparing clean uninstall..."
  !insertmacro _RequestInAppMaintenance "--prepare-uninstall"
  !insertmacro _ClearStartupEntries
  !insertmacro _StopKnownKioskProcesses
  Sleep 1200
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    !insertmacro _TryDisableAssignedAccess
    !insertmacro _StopKnownKioskProcesses
    Sleep 1200
  ${endif}
!macroend
