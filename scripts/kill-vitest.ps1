$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectRootPattern = [regex]::Escape($projectRoot)

$processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object {
    $_.CommandLine -match $projectRootPattern -and
    ($_.CommandLine -match 'vitest' -or $_.CommandLine -match 'workers[\\/]+forks\.js')
  }

if (-not $processes) {
  Write-Host "No Vitest node processes found for $projectRoot."
  exit 0
}

$processes |
  Select-Object ProcessId, CommandLine |
  Format-Table -AutoSize

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Stopped $($processes.Count) Vitest node process(es) for $projectRoot."
