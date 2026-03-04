param(
    [string]$SetupUrl = "",
    [string]$LocalSetupPath = ""
)

$ErrorActionPreference = "Stop"

function Ensure-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "Relaunching as Administrator..."
        $argList = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $PSCommandPath
        )
        if ($SetupUrl) {
            $argList += @("-SetupUrl", $SetupUrl)
        }
        if ($LocalSetupPath) {
            $argList += @("-LocalSetupPath", $LocalSetupPath)
        }
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList
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

function Remove-KioskInstallTraces {
    Write-Host "Trying clean-install fallback: removing old install traces..."
    $entries = Get-KioskRegistryEntries

    foreach ($entry in $entries) {
        if ($entry.InstallLocation -and (Test-Path -LiteralPath $entry.InstallLocation)) {
            Write-Host "Removing install directory: $($entry.InstallLocation)"
            Remove-Item -LiteralPath $entry.InstallLocation -Recurse -Force
        }
    }

    foreach ($entry in $entries) {
        if ($entry.PSPath) {
            Write-Host "Removing uninstall registry key: $($entry.PSPath)"
            Remove-Item -LiteralPath $entry.PSPath -Recurse -Force
        }
    }
}

function Run-Installer {
    param(
        [string]$SetupPath,
        [string[]]$InstallerArgs = @()
    )

    if (-not (Test-Path -LiteralPath $SetupPath)) {
        throw "Setup file not found: $SetupPath"
    }

    if ($InstallerArgs -and $InstallerArgs.Count -gt 0) {
        $argLine = [string]::Join(" ", $InstallerArgs)
        $proc = Start-Process -FilePath $SetupPath -ArgumentList $argLine -Wait -PassThru
    } else {
        $proc = Start-Process -FilePath $SetupPath -Wait -PassThru
    }
    return $proc.ExitCode
}

function Resolve-SetupPath {
    if ($LocalSetupPath -and (Test-Path -LiteralPath $LocalSetupPath)) {
        return (Resolve-Path -LiteralPath $LocalSetupPath).Path
    }

    $localCandidate = Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter "Universitet Kiosk Setup *.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($localCandidate) {
        return $localCandidate.FullName
    }

    if (-not $SetupUrl) {
        Write-Host "No setup source provided. Use -LocalSetupPath or -SetupUrl."
        Write-Host "Also checked local folder: $PSScriptRoot"
        exit 2
    }

    $workDir = Join-Path $env:ProgramData "UniversityKiosk\Updater"
    New-Item -ItemType Directory -Force -Path $workDir | Out-Null

    $dest = Join-Path $workDir "Universitet-Kiosk-Setup-latest.exe"
    Write-Host "Downloading setup from: $SetupUrl"
    Invoke-WebRequest -Uri $SetupUrl -OutFile $dest -UseBasicParsing
    return $dest
}

try {
    Ensure-Admin

    $setupPath = Resolve-SetupPath
    Write-Host "Using setup: $setupPath"

    Write-Host "Stopping kiosk and Assigned Access..."
    Disable-KioskPolicies
    Stop-KioskProcesses

    if (Test-KioskPolicyPresent) {
        Write-Host "Kiosk policy is still active (likely re-applied by Intune/MDM)."
        Write-Host "Temporarily unassign the kiosk policy in Intune, then run update again."
        exit 3
    }

    Write-Host "Running installer silently..."
    $exitCode = Run-Installer -SetupPath $setupPath -InstallerArgs @("/S", "/allusers")

    if ($exitCode -eq 2) {
        Write-Host "Silent installer returned code 2. Retrying with clean-install fallback..."
        Stop-KioskProcesses
        Remove-KioskInstallTraces
        $exitCode = Run-Installer -SetupPath $setupPath -InstallerArgs @("/S", "/allusers")
    }

    if ($exitCode -eq 2) {
        Write-Host "Still code 2. Running interactive installer for explicit error message..."
        $exitCode = Run-Installer -SetupPath $setupPath -InstallerArgs @("/allusers")
    }

    Stop-KioskProcesses

    if ($exitCode -ne 0) {
        Write-Host "Installer failed with exit code: $exitCode"
        exit $exitCode
    }

    Write-Host "Update completed successfully."
    exit 0
}
catch {
    Write-Host "Fatal script error: $($_.Exception.Message)"
    exit 99
}
