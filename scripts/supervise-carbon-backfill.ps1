param(
  [int]$IntervalSeconds = 60
)

$ErrorActionPreference = "Continue"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$backfillScript = Join-Path $scriptRoot "backfill-carbon-graced-db-only.ps1"
$progressScript = Join-Path $scriptRoot "carbon-backfill-progress.mjs"
$progressJson = Join-Path $repoRoot "carbon-db-only-progress.json"
$progressText = Join-Path $repoRoot "carbon-db-only-progress.txt"
$mainPidPath = Join-Path $repoRoot "carbon-db-only-autoresume-backfill.pid"
$mainStatusLog = Join-Path $repoRoot "carbon-db-only-autoresume-backfill.status.log"
$mainOutLog = Join-Path $repoRoot "carbon-db-only-autoresume-backfill.log"
$mainErrLog = Join-Path $repoRoot "carbon-db-only-autoresume-backfill.err.log"
$supervisorLog = Join-Path $repoRoot "carbon-db-only-supervisor.log"

function Write-SupervisorLog {
  param([string]$Message)
  Add-Content -LiteralPath $supervisorLog -Value "[$((Get-Date).ToString('s'))] $Message"
}

function Test-ProcessAlive {
  param([string]$PidPath)
  if (-not (Test-Path -LiteralPath $PidPath)) {
    return $false
  }
  $pidText = (Get-Content -LiteralPath $PidPath -Raw).Trim()
  $processId = 0
  if (-not [int]::TryParse($pidText, [ref]$processId)) {
    return $false
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  return $null -ne $process -and $process.CommandLine -like "*backfill-carbon-graced-db-only.ps1*"
}

function Start-BackfillFromLastKnownGap {
  if (Test-ProcessAlive $mainPidPath) {
    return $true
  }
  if (-not (Test-Path -LiteralPath $progressJson)) {
    Write-SupervisorLog "backfill not alive; no progress json available for restart"
    return $false
  }
  try {
    $progress = Get-Content -LiteralPath $progressJson -Raw | ConvertFrom-Json
    $gap = $progress.sectors | Where-Object { $_.firstMissing } | Select-Object -First 1
    if ($null -eq $gap) {
      Write-SupervisorLog "backfill not alive; no last-known gap found"
      return $false
    }
    Write-SupervisorLog "backfill not alive; restarting from last-known $($gap.sector) $($gap.firstMissing)"
    Start-BackfillFromGap $gap.sector $gap.firstMissing
    return $true
  } catch {
    Write-SupervisorLog "backfill not alive; failed to restart from last-known gap: $($_.Exception.Message)"
    return $false
  }
}

function Start-BackfillFromGap {
  param([string]$Sector, [string]$Month)
  $startMonth = $Month
  $startDate = ""
  if ($Month -match '^\d{4}-\d{2}-\d{2}$') {
    $startMonth = $Month.Substring(0, 7)
    $startDate = $Month
  } elseif ($Sector -eq "InternationalAviation" -and $Month -eq "2019-10") {
    $startDate = "2019-10-20"
  }
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $backfillScript,
    "-StartSector",
    $Sector,
    "-StartMonth",
    $startMonth,
    "-EndMonth",
    "2026-05",
    "-StatusLog",
    $mainStatusLog
  )
  if (-not [string]::IsNullOrWhiteSpace($startDate)) {
    $arguments += @("-StartDate", $startDate)
  }
  $proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList $arguments `
    -RedirectStandardOutput $mainOutLog `
    -RedirectStandardError $mainErrLog `
    -PassThru `
    -WindowStyle Hidden
  Start-Sleep -Seconds 2
  try {
    (Get-Process -Id $proc.Id).PriorityClass = "BelowNormal"
  } catch {}
  Set-Content -LiteralPath $mainPidPath -Value $proc.Id
  Write-SupervisorLog "started backfill pid=$($proc.Id) from $Sector $startMonth startDate=$startDate"
}

Push-Location $repoRoot
try {
  Write-SupervisorLog "supervisor started interval=${IntervalSeconds}s"
  while ($true) {
    try {
      node $progressScript --write *> $null
      $progress = Get-Content -LiteralPath $progressJson -Raw | ConvertFrom-Json
      $percent = [double]$progress.overall.percent
      if ($percent -ge 100) {
        Write-SupervisorLog "progress reached 100%; supervisor exiting"
        break
      }

      if (Test-ProcessAlive $mainPidPath) {
        Write-SupervisorLog "backfill alive; progress=$percent%; current=$($progress.current.line)"
      } else {
        $gap = $progress.sectors | Where-Object { $_.firstMissing } | Select-Object -First 1
        if ($null -eq $gap) {
          Write-SupervisorLog "no gap found but progress=$percent%; will recheck"
        } else {
          Write-SupervisorLog "backfill not alive; restarting from $($gap.sector) $($gap.firstMissing)"
          Start-BackfillFromGap $gap.sector $gap.firstMissing
        }
      }
    } catch {
      Write-SupervisorLog "supervisor iteration failed: $($_.Exception.Message)"
      [void](Start-BackfillFromLastKnownGap)
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  Pop-Location
}
