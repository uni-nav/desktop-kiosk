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
        "University Kiosk.exe",
        "university-kiosk.exe",
        "electron.exe",
        "crashpad_handler.exe"
    )

    $checkNames = @(
        "Universitet Kiosk",
        "University Kiosk",
        "university-kiosk",
        "electron",
        "crashpad_handler"
    )

    for ($attempt = 1; $attempt -le 4; $attempt++) {
        foreach ($name in $processNames) {
            taskkill /F /T /IM $name | Out-Null
        }

        Start-Sleep -Seconds 1

        $stillRunning = $false
        foreach ($checkName in $checkNames) {
            if (Get-Process -Name $checkName -ErrorAction SilentlyContinue) {
                $stillRunning = $true
                break
            }
        }

        if (-not $stillRunning) {
            return
        }
    }
}

function Remove-KioskAutoStartEntries {
    $runPaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"
    )
    $entryNames = @(
        "Universitet Kiosk",
        "University Kiosk",
        "university-kiosk",
        "Universitet Kiosk.exe",
        "university-kiosk.exe"
    )

    foreach ($path in $runPaths) {
        foreach ($name in $entryNames) {
            Remove-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
        }
    }
}

function Get-KioskRegistryEntries {
    $paths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    $items = @()
    foreach ($path in $paths) {
        $items += Get-ItemProperty -Path $path | Where-Object {
            $_.DisplayName -like "*Universitet Kiosk*" -or $_.DisplayName -like "*university-kiosk*"
        }
    }
    return $items
}

function Resolve-KioskExecutablePath {
    $entries = Get-KioskRegistryEntries
    $exeNames = @(
        "Universitet Kiosk.exe",
        "University Kiosk.exe",
        "university-kiosk.exe"
    )

    foreach ($entry in $entries) {
        if ($entry.InstallLocation -and (Test-Path -LiteralPath $entry.InstallLocation)) {
            foreach ($exeName in $exeNames) {
                $candidate = Join-Path $entry.InstallLocation $exeName
                if (Test-Path -LiteralPath $candidate) {
                    return $candidate
                }
            }
        }
    }

    foreach ($entry in $entries) {
        if ($entry.DisplayIcon) {
            $iconPath = [string]$entry.DisplayIcon
            $iconPath = $iconPath.Split(',')[0].Trim('"')
            if (Test-Path -LiteralPath $iconPath) {
                return $iconPath
            }
        }
    }

    return $null
}

function Request-InAppMaintenanceMode([string]$ModeFlag) {
    $exePath = Resolve-KioskExecutablePath
    if (-not $exePath) {
        return
    }

    try {
        Write-Host "Requesting in-app maintenance: $ModeFlag"
        Start-Process -FilePath $exePath -ArgumentList $ModeFlag -WindowStyle Hidden | Out-Null
        Start-Sleep -Seconds 2
    }
    catch {
        Write-Host "In-app maintenance request failed: $($_.Exception.Message)"
    }
}

function Find-UninstallCommand {
    $entries = Get-KioskRegistryEntries
    foreach ($entry in $entries) {

        if ($entry) {
            if ($entry.QuietUninstallString) {
                return [string]$entry.QuietUninstallString
            }
            if ($entry.UninstallString) {
                return [string]$entry.UninstallString
            }
        }
    }

    return $null
}

function Split-CommandLine {
    param([string]$CommandLine)

    $line = ($CommandLine | Out-String).Trim()
    if (-not $line) {
        throw "Empty uninstall command."
    }

    if ($line.StartsWith('"')) {
        $endQuote = $line.IndexOf('"', 1)
        if ($endQuote -lt 1) {
            throw "Invalid quoted command: $line"
        }
        $filePath = $line.Substring(1, $endQuote - 1)
        $args = $line.Substring($endQuote + 1).Trim()
    } else {
        $parts = $line.Split(' ', 2)
        $filePath = $parts[0]
        $args = if ($parts.Count -gt 1) { $parts[1] } else { "" }
    }

    return [PSCustomObject]@{
        FilePath = $filePath
        Arguments = $args
    }
}

function Run-Uninstall($uninstallCommand) {
    if (-not $uninstallCommand) {
        Write-Host "Uninstall command not found in registry."
        return 0
    }

    $parsed = Split-CommandLine -CommandLine $uninstallCommand
    $exePath = $parsed.FilePath
    $args = [string]$parsed.Arguments

    if (-not [System.IO.Path]::GetExtension($exePath)) {
        $resolved = (Get-Command $exePath -ErrorAction SilentlyContinue)
        if ($resolved) {
            $exePath = $resolved.Source
        }
    }

    if ($args -notmatch "(^| )/S($| )") {
        $args = "$args /S".Trim()
    }
    if ($args -notmatch "(^| )/allusers($| )") {
        $args = "$args /allusers".Trim()
    }

    Write-Host "Running uninstall command..."
    Write-Host "Executable: $exePath"
    Write-Host "Arguments : $args"
    $proc = Start-Process -FilePath $exePath -ArgumentList $args -Wait -PassThru
    return $proc.ExitCode
}

Ensure-Admin
Request-InAppMaintenanceMode -ModeFlag "--prepare-uninstall"
Write-Host "Stopping kiosk and disabling Assigned Access..."
Disable-KioskPolicies
Remove-KioskAutoStartEntries
Stop-KioskProcesses

if (Test-KioskPolicyPresent) {
    Write-Host "Kiosk policy is still active (likely re-applied by Intune/MDM)."
    Write-Host "Temporarily unassign the kiosk policy in Intune, then run this script again."
    exit 3
}

$uninstallCommand = Find-UninstallCommand
$exitCode = Run-Uninstall -uninstallCommand $uninstallCommand
if ($exitCode -ne 0 -and $exitCode -ne 3010) {
    Write-Host "Uninstall returned exit code: $exitCode"
}

Write-Host "Final process cleanup..."
Remove-KioskAutoStartEntries
Stop-KioskProcesses

Write-Host "Done."
