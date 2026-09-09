$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path (Split-Path -Parent $repoRoot) "data\carbon-graced-restore-scratch"
$manifestPath = Join-Path $outputRoot "scratch\_current\processed\manifest.json"

$restorePlan = @(
    @{ Sector = "Power"; Month = "2020-02" },
    @{ Sector = "Power"; Month = "2020-03" },
    @{ Sector = "total"; Month = "2021-02" },
    @{ Sector = "total"; Month = "2021-03" }
)

Push-Location $repoRoot
try {
    foreach ($item in $restorePlan) {
        Write-Output "Restoring $($item.Sector) / $($item.Month) at 0.1 degree"
        $synced = $false
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            & python "scripts/sync-carbon-graced.py" `
                --sector $item.Sector `
                --month $item.Month `
                --output-root $outputRoot `
                --scratch-output `
                --single-scratch-slot `
                --target-resolution 0.1
            if ($LASTEXITCODE -eq 0) {
                $synced = $true
                break
            }
            Write-Output "Retrying $($item.Sector) / $($item.Month), attempt $($attempt + 1)"
            Start-Sleep -Seconds (5 * $attempt)
        }
        if (-not $synced) {
            throw "GRACED sync failed for $($item.Sector) / $($item.Month) after 3 attempts."
        }

        & node "scripts/import-carbon-graced.mjs" --manifest $manifestPath
        if ($LASTEXITCODE -ne 0) {
            throw "Database import failed for $($item.Sector) / $($item.Month)."
        }
    }
}
finally {
    Pop-Location
}

Write-Output "Carbon source-resolution restore completed."
