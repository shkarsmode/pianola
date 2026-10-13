# Registers the Pianola worker to start at logon (current user, hidden window, restarts on crash).
# Run:   powershell -ExecutionPolicy Bypass -File worker\install-autostart.ps1
# Remove: Unregister-ScheduledTask -TaskName "Pianola Worker" -Confirm:$false

$ErrorActionPreference = "Stop"
$worker = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonw = Join-Path $worker ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $pythonw)) { throw "Python venv not found at $pythonw" }
if (-not (Test-Path (Join-Path $worker ".env"))) { throw "worker\.env is missing" }

$action = New-ScheduledTaskAction -Execute $pythonw -Argument "-m pianola_worker" -WorkingDirectory $worker
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "Pianola Worker" -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description "Pianola: turns queued songs into falling piano notes" -Force | Out-Null
Start-ScheduledTask -TaskName "Pianola Worker"
Write-Host "Pianola Worker registered and started."
