param(
    [string]$SetupUrl = "",
    [string]$LocalSetupPath = "",
    [string]$ExpectedSha256 = "",
    [switch]$AllowUnsignedPackage,
    [switch]$AllowInsecureDownload
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
        if ($ExpectedSha256) {
            $argList += @("-ExpectedSha256", $ExpectedSha256)
        }
        if ($AllowUnsignedPackage) {
            $argList += "-AllowUnsignedPackage"
        }
        if ($AllowInsecureDownload) {
            $argList += "-AllowInsecureDownload"
        }
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList
        exit
    }
}

function Assert-HttpsUrl([string]$Url) {
    if (-not $Url) { return }
    $uri = [Uri]$Url
    if (-not $AllowInsecureDownload -and $uri.Scheme -ne "https") {
        throw "Insecure setup URL blocked. Use HTTPS or pass -AllowInsecureDownload."
    }
}

function Validate-SetupPackage([string]$SetupPath) {
    if (-not (Test-Path -LiteralPath $SetupPath)) {
        throw "Setup file not found for validation: $SetupPath"
    }

    if ($ExpectedSha256) {
        $actual = (Get-FileHash -LiteralPath $SetupPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $expected = $ExpectedSha256.Trim().ToLowerInvariant()
        if ($actual -ne $expected) {
            throw "SHA256 mismatch. Expected=$expected, Actual=$actual"
        }
        Write-Host "SHA256 check passed."
    }

    $sig = Get-AuthenticodeSignature -FilePath $SetupPath
    if ($sig.Status -eq [System.Management.Automation.SignatureStatus]::Valid) {
        Write-Host "Signature check passed."
        return
    }

    if ($AllowUnsignedPackage) {
        Write-Host "WARNING: signature invalid/missing but -AllowUnsignedPackage was provided."
        return
    }

    if ($LocalSetupPath -and -not $ExpectedSha256) {
        Write-Host "WARNING: local package is unsigned and no SHA256 provided. Proceeding with local-trust mode."
        return
    }

    throw "Installer signature is not valid (status: $($sig.Status)). Refusing to execute unsigned package."
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

function Remove-KioskInstallTraces {
    Write-Host "Trying clean-install fallback: removing old install traces..."
    Remove-KioskAutoStartEntries
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

    Assert-HttpsUrl -Url $SetupUrl

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
    Validate-SetupPackage -SetupPath $setupPath

    Request-InAppMaintenanceMode -ModeFlag "--prepare-update"

    Write-Host "Stopping kiosk and Assigned Access..."
    Disable-KioskPolicies
    Remove-KioskAutoStartEntries
    Stop-KioskProcesses

    if (Test-KioskPolicyPresent) {
        Write-Host "Kiosk policy is still active (likely re-applied by Intune/MDM)."
        Write-Host "Temporarily unassign the kiosk policy in Intune, then run update again."
        exit 3
    }

    Write-Host "Running installer silently..."
    $exitCode = Run-Installer -SetupPath $setupPath -InstallerArgs @("/S", "/allusers")

    if ($exitCode -in @(1, 2)) {
        Write-Host "Silent installer returned code $exitCode. Retrying with clean-install fallback..."
        Remove-KioskAutoStartEntries
        Stop-KioskProcesses
        Remove-KioskInstallTraces
        $exitCode = Run-Installer -SetupPath $setupPath -InstallerArgs @("/S", "/allusers")
    }

    if ($exitCode -in @(1, 2)) {
        Write-Host "Still code $exitCode. Running interactive installer for explicit error message..."
        $exitCode = Run-Installer -SetupPath $setupPath -InstallerArgs @("/allusers")
    }

    Remove-KioskAutoStartEntries
    Stop-KioskProcesses

    if ($exitCode -eq 3010) {
        Write-Host "Update completed. Reboot required (exit code 3010)."
        exit 0
    }

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
