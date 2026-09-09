param(
  [int]$IntervalSeconds = 30
)

$ErrorActionPreference = "Continue"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$progressScript = Join-Path $scriptRoot "carbon-backfill-progress.mjs"
$watchLog = Join-Path $repoRoot "carbon-db-only-progress-watch.log"

Push-Location $repoRoot
try {
  while ($true) {
    $timestamp = (Get-Date).ToString("s")
    try {
      node $progressScript --write *> $null
      Add-Content -LiteralPath $watchLog -Value "[$timestamp] progress refreshed"
    } catch {
      Add-Content -LiteralPath $watchLog -Value "[$timestamp] progress refresh failed: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  Pop-Location
}
