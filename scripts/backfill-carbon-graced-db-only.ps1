param(
  [string]$Python = "C:\Users\53472\anaconda3\python.exe",
  [string]$StartMonth = "2019-01",
  [string]$EndMonth = "2026-05",
  [string]$StartSector = "",
  [string]$StartDate = "",
  [string]$StatusLog = "",
  [int]$SyncAttempts = 5,
  [int]$ImportAttempts = 10000,
  [int]$SyncTimeoutSeconds = 120,
  [int]$ImportTimeoutSeconds = 120,
  [int]$FramesPerImport = 1
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$workspaceRoot = Split-Path -Parent $repoRoot
$outputRoot = Join-Path $workspaceRoot "data\carbon-graced-minscratch"
$manifestPath = Join-Path $outputRoot "scratch\_current\processed\manifest.json"
if ([string]::IsNullOrWhiteSpace($StatusLog)) {
  $StatusLog = Join-Path $repoRoot "carbon-db-only-autoresume-backfill.status.log"
}
$script:CarbonBackfillStatusLog = $StatusLog

$sectors = @(
  "Power",
  "total",
  "Industry",
  "Residential",
  "GroundTransportation",
  "DomesticAviation",
  "InternationalAviation",
  "InternationalShipping"
)

function Write-Stamped {
  param([string]$Message)
  $line = "[$((Get-Date).ToString('s'))] $Message"
  Add-Content -LiteralPath $script:CarbonBackfillStatusLog -Value $line
}

function Get-Months {
  param([string]$FromMonth, [string]$ToMonth)
  $cursor = [datetime]::ParseExact("$FromMonth-01", "yyyy-MM-dd", $null)
  $end = [datetime]::ParseExact("$ToMonth-01", "yyyy-MM-dd", $null)
  while ($cursor -le $end) {
    $cursor.ToString("yyyy-MM")
    $cursor = $cursor.AddMonths(1)
  }
}

function Get-DaysInMonthLabel {
  param([string]$Month)
  $date = [datetime]::ParseExact("$Month-01", "yyyy-MM-dd", $null)
  [datetime]::DaysInMonth($date.Year, $date.Month)
}

function Get-ImportedFrameCount {
  param([string]$Sector, [string]$Month)
  $env:CARBON_CHECK_SECTOR = $Sector
  $env:CARBON_CHECK_MONTH = $Month
  $countStdoutLog = Join-Path $repoRoot "carbon-count-$PID.out.log"
  $countStderrLog = Join-Path $repoRoot "carbon-count-$PID.err.log"
  Set-Content -LiteralPath $countStdoutLog -Value ""
  Set-Content -LiteralPath $countStderrLog -Value ""
  $process = Start-Process -FilePath $Python `
    -ArgumentList @("scripts\count-carbon-frames.py") `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $countStdoutLog `
    -RedirectStandardError $countStderrLog `
    -PassThru `
    -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(60)
  while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
      $process.Refresh()
    } catch {
      break
    }
  }
  if (-not $process.HasExited) {
    try {
      Stop-Process -Id $process.Id -Force
    } catch {}
    return -1
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    return -1
  }
  $value = Get-Content -LiteralPath $countStdoutLog -Tail 1 -ErrorAction SilentlyContinue
  $count = -1
  if ([int]::TryParse(($value | Select-Object -Last 1), [ref]$count)) {
    return $count
  }
  return -1
}

function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Command,
    [int]$Attempts
  )
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    Write-Stamped "$Label attempt $attempt/$Attempts"
    & $Command
    if ($LASTEXITCODE -eq 0) {
      return $true
    }
    Write-Stamped "$Label failed with exit $LASTEXITCODE"
    Start-Sleep -Seconds ([Math]::Min(60, 15 * $attempt))
  }
  return $false
}

function Test-CurrentManifestReady {
  param([string]$Sector, [string]$Month)
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    return $false
  }
  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $expectedFrames = Get-DaysInMonthLabel $Month
    $frameCount = @($manifest.frames).Count
    return ($manifest.sector -eq $Sector -and $manifest.month -eq $Month -and $frameCount -eq $expectedFrames)
  } catch {
    return $false
  }
}

function Invoke-SyncMonth {
  param(
    [string]$Sector,
    [string]$Month,
    [int]$Attempt,
    [int]$Attempts
  )
  Write-Stamped "SYNC $Sector $Month attempt $Attempt/$Attempts"
  $syncStdoutLog = Join-Path $repoRoot "carbon-sync-last.out.log"
  $syncStderrLog = Join-Path $repoRoot "carbon-sync-last.err.log"
  $process = Start-Process -FilePath $Python `
    -ArgumentList @(
      "-u",
      "scripts\sync-carbon-graced.py",
      "--sector",
      $Sector,
      "--month",
      $Month,
      "--scratch-output",
      "--single-scratch-slot",
      "--quiet",
      "--output-root",
      $outputRoot
    ) `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $syncStdoutLog `
    -RedirectStandardError $syncStderrLog `
    -PassThru `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds($SyncTimeoutSeconds)
  while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
      $process.Refresh()
    } catch {
      break
    }
  }

  if (-not $process.HasExited) {
    try {
      Stop-Process -Id $process.Id -Force
    } catch {
      # The process may have exited after the timeout check.
    }
    Write-Stamped "SYNC $Sector $Month failed with timeout after ${SyncTimeoutSeconds}s"
    Start-Sleep -Seconds ([Math]::Min(60, 15 * $Attempt))
    return $false
  }
  $process.WaitForExit()

  if (Test-CurrentManifestReady $Sector $Month) {
    Write-Stamped "SYNC $Sector $Month manifest ready"
    return $true
  }

  if ($process.ExitCode -ne 0) {
    Write-Stamped "SYNC $Sector $Month failed with exit $($process.ExitCode)"
    if (Test-Path -LiteralPath $syncStderrLog) {
      Get-Content -LiteralPath $syncStderrLog -Tail 6 | ForEach-Object {
        if ($_ -ne "") { Write-Stamped "SYNC STDERR $_" }
      }
    }
    Start-Sleep -Seconds ([Math]::Min(60, 15 * $Attempt))
    return $false
  }

  return $true
}

function Invoke-ImportOneFrame {
  param(
    [string]$Label,
    [int]$Attempt,
    [int]$Attempts,
    [string]$FrameStartDate
  )
  Write-Stamped "$Label attempt $Attempt/$Attempts"
  $importStdoutLog = Join-Path $repoRoot "carbon-import-last.out.log"
  $importStderrLog = Join-Path $repoRoot "carbon-import-last.err.log"
  $importArgs = @(
    "scripts\import-carbon-graced.py",
    "--manifest",
    $manifestPath,
    "--skip-schema",
    "--skip-existing-archive",
    "--skip-existing-frame-read",
    "--direct-frame-only",
    "--psql-direct-write",
    "--downsample-large-frames",
    "20",
    "--max-new-frames",
    ([string]$FramesPerImport)
  )
  if (-not [string]::IsNullOrWhiteSpace($FrameStartDate)) {
    $importArgs += @("--start-date", $FrameStartDate)
  }
  $process = Start-Process -FilePath $Python `
    -ArgumentList $importArgs `
    -RedirectStandardOutput $importStdoutLog `
    -RedirectStandardError $importStderrLog `
    -PassThru `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds($ImportTimeoutSeconds)
  while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
      $process.Refresh()
    } catch {
      break
    }
  }

  if (-not $process.HasExited) {
    try {
      Stop-Process -Id $process.Id -Force
    } catch {
      # The process may have exited after the timeout check.
    }
    Write-Stamped "$Label failed with timeout after ${ImportTimeoutSeconds}s"
    Start-Sleep -Seconds 5
    return $false
  }
  $process.WaitForExit()

  if ($process.ExitCode -ne 0) {
    $successOutput = Select-String -LiteralPath $importStdoutLog -Pattern @('"ok"\s*:\s*true', 'INSERT 0 1', 'storage=.*psql') -Quiet -ErrorAction SilentlyContinue
    if ($successOutput) {
      Write-Stamped "$Label completed; import stdout reported successful write"
      return $true
    }
    Write-Stamped "$Label failed with exit $($process.ExitCode)"
    if (Test-Path -LiteralPath $importStderrLog) {
      Get-Content -LiteralPath $importStderrLog -Tail 6 | ForEach-Object {
        if ($_ -ne "") { Write-Stamped "IMPORT STDERR $_" }
      }
    }
    Start-Sleep -Seconds 5
    return $false
  }

  return $true
}

Push-Location $repoRoot
try {
  Write-Stamped "carbon GRACED DB-only backfill started"
  Write-Stamped "repo=$repoRoot outputRoot=$outputRoot range=$StartMonth..$EndMonth"

  $sectorStarted = [string]::IsNullOrWhiteSpace($StartSector)
  foreach ($sector in $sectors) {
    if (-not $sectorStarted) {
      if ($sector -eq $StartSector) {
        $sectorStarted = $true
      } else {
        Write-Stamped "SKIP sector $sector before StartSector=$StartSector"
        continue
      }
    }

    $sectorStartMonth = "2019-01"
    if ($sector -eq $StartSector -and -not [string]::IsNullOrWhiteSpace($StartMonth)) {
      $sectorStartMonth = $StartMonth
    }

    foreach ($month in Get-Months $sectorStartMonth $EndMonth) {
      $expected = Get-DaysInMonthLabel $month
      $monthBaseDate = [datetime]::ParseExact("$month-01", "yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)
      $startDateOffset = 0
      if ($sector -eq $StartSector -and $month -eq $StartMonth -and -not [string]::IsNullOrWhiteSpace($StartDate)) {
        $parsedStartDate = [datetime]::ParseExact($StartDate, "yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)
        $startDateOffset = [Math]::Max(0, [int]($parsedStartDate - $monthBaseDate).TotalDays)
      }
      $existing = Get-ImportedFrameCount $sector $month
      if ($existing -lt 0) {
        Write-Stamped "COUNT $sector $month unavailable; continuing with importer checks"
        $existing = 0
      }
      if ($existing -lt $startDateOffset) {
        $existing = $startDateOffset
      }
      if ($existing -ge $expected) {
        Write-Stamped "SKIP $sector $month existing=$existing expected=$expected"
        continue
      }
      Write-Stamped "START $sector $month existing=$existing expected=$expected"
      if (Test-CurrentManifestReady $sector $month) {
        Write-Stamped "SYNC $sector $month skipped; manifest already ready"
        $syncOk = $true
      } else {
        $syncOk = $false
        for ($syncAttempt = 1; $syncAttempt -le $SyncAttempts; $syncAttempt++) {
          if (Invoke-SyncMonth $sector $month $syncAttempt $SyncAttempts) {
            $syncOk = $true
            break
          }
        }
      }

      if (-not $syncOk) {
        throw "SYNC failed permanently for $sector $month"
      }

      $importAttempt = 0
      $after = Get-ImportedFrameCount $sector $month
      if ($after -lt 0) {
        Write-Stamped "COUNT $sector $month unavailable after sync; continuing with importer checks"
        $after = 0
      }
      if ($after -lt $startDateOffset) {
        $after = $startDateOffset
      }
      while ($after -lt $expected) {
        $importAttempt += 1
        if ($importAttempt -gt $ImportAttempts) {
          throw "IMPORT failed permanently for $sector $month"
        }
        $frameStartDate = $monthBaseDate.AddDays($after).ToString("yyyy-MM-dd")
        $previousAfter = $after
        $expectedAfterImport = [Math]::Min($expected, $after + $FramesPerImport)
        $importOk = Invoke-ImportOneFrame "IMPORT $sector $month from $frameStartDate" $importAttempt $ImportAttempts $frameStartDate
        $after = Get-ImportedFrameCount $sector $month
        if ($after -lt 0) {
          if ($importOk) {
            $after = $expectedAfterImport
            Write-Stamped "COUNT $sector $month unavailable after successful import; advancing local cursor to $after/$expected"
          } else {
            Write-Stamped "COUNT $sector $month unavailable after import; continuing import attempts"
            $after = $previousAfter
          }
        }
      }

      if ($after -lt $expected) {
        throw "Imported row count is incomplete for $sector ${month}: after=$after expected=$expected"
      }

      $free = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" |
        Select-Object -ExpandProperty FreeSpace
      Write-Stamped "DONE $sector $month rows=$after freeGB=$([Math]::Round($free / 1GB, 2))"
    }
  }

  Write-Stamped "carbon GRACED DB-only backfill completed"
} finally {
  Pop-Location
}
