$ErrorActionPreference = "SilentlyContinue"

function Ensure-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "Relaunching as Administrator..."
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        exit
    }
}

function Invoke-AsSystem([string]$Body) {
    $workDir = Join-Path $env:ProgramData "UniversityKiosk\Updater"
    New-Item -ItemType Directory -Force -Path $workDir | Out-Null

    $taskName = "UniversityKiosk-System-" + [Guid]::NewGuid().ToString("N")
    $scriptPath = Join-Path $workDir ($taskName + ".ps1")
    Set-Content -LiteralPath $scriptPath -Value $Body -Encoding UTF8

    schtasks /Create /F /TN $taskName /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" | Out-Null
    schtasks /Run /TN $taskName | Out-Null
    Start-Sleep -Seconds 5
    schtasks /Delete /F /TN $taskName | Out-Null
    Remove-Item -LiteralPath $scriptPath -Force
}

function Clear-AssignedAccessCim {
    $namespaceName = "root\cimv2\mdm\dmmap"
    $className = "MDM_AssignedAccess"
    $obj = Get-CimInstance -Namespace $namespaceName -ClassName $className
    if ($obj) {
        $obj.Configuration = $null
        $obj.ShellLauncher = $null
        Set-CimInstance -CimInstance $obj | Out-Null
    }
}

function Disable-KioskPolicies {
    if (Get-Command Clear-AssignedAccess -ErrorAction SilentlyContinue) {
        Clear-AssignedAccess
        Write-Host "Assigned Access cleared with Clear-AssignedAccess."
    }

    Clear-AssignedAccessCim

    $systemScript = @'
$ErrorActionPreference = "SilentlyContinue"
$namespaceName = "root\cimv2\mdm\dmmap"
$className = "MDM_AssignedAccess"
$obj = Get-CimInstance -Namespace $namespaceName -ClassName $className
if ($obj) {
    $obj.Configuration = $null
    $obj.ShellLauncher = $null
    Set-CimInstance -CimInstance $obj | Out-Null
}
if (Get-Command Clear-AssignedAccess -ErrorAction SilentlyContinue) {
    Clear-AssignedAccess
}
'@
    Invoke-AsSystem -Body $systemScript

    Stop-Service -Name AssignedAccessManagerSvc -Force
    Set-Service -Name AssignedAccessManagerSvc -StartupType Manual
}

function Test-KioskPolicyPresent {
    $namespaceName = "root\cimv2\mdm\dmmap"
    $className = "MDM_AssignedAccess"
    $obj = Get-CimInstance -Namespace $namespaceName -ClassName $className
    if (-not $obj) { return $false }

    $cfg = [string]$obj.Configuration
    $shell = [string]$obj.ShellLauncher
    return ($cfg.Trim().Length -gt 0 -or $shell.Trim().Length -gt 0)
}

function Stop-KioskProcesses {
    $processNames = @(
        "Universitet Kiosk.exe",
        "university-kiosk.exe",
        "electron.exe",
        "crashpad_handler.exe"
    )

    foreach ($name in $processNames) {
        taskkill /F /T /IM $name | Out-Null
    }
}

function Find-UninstallString {
    $paths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    foreach ($path in $paths) {
        $entry = Get-ItemProperty -Path $path | Where-Object {
            $_.DisplayName -like "*Universitet Kiosk*" -or $_.DisplayName -like "*university-kiosk*"
        } | Select-Object -First 1

        if ($entry -and $entry.UninstallString) {
            return $entry.UninstallString
        }
    }

    return $null
}

function Run-Uninstall($uninstallString) {
    if (-not $uninstallString) {
        Write-Host "UninstallString not found in registry."
        return
    }

    $cmd = $uninstallString
    if ($cmd -notmatch "(^| )/S($| )") {
        $cmd = "$cmd /S"
    }
    if ($cmd -notmatch "(^| )/allusers($| )") {
        $cmd = "$cmd /allusers"
    }

    Write-Host "Running uninstall command..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmd" -Wait
}

Ensure-Admin
Write-Host "Stopping kiosk and disabling Assigned Access..."
Disable-KioskPolicies
Stop-KioskProcesses

if (Test-KioskPolicyPresent) {
    Write-Host "Kiosk policy is still active (likely re-applied by Intune/MDM)."
    Write-Host "Temporarily unassign the kiosk policy in Intune, then run this script again."
    exit 3
}

$uninstallString = Find-UninstallString
Run-Uninstall -uninstallString $uninstallString

Write-Host "Final process cleanup..."
Stop-KioskProcesses

Write-Host "Done."
