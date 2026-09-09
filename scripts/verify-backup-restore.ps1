$ErrorActionPreference = 'Stop'
$auditOutput = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'outputs\20260904-pg-migration'
$auditReportPath = Join-Path $auditOutput 'final-verification.json'
$auditReport = Get-Content -LiteralPath $auditReportPath -Raw | ConvertFrom-Json
if ($auditReport.backup.status -ne 'complete') { throw 'Complete backup required' }
$auditBackup = $auditReport.backup.file
if ((Get-FileHash -LiteralPath $auditBackup -Algorithm SHA256).Hash -ne $auditReport.backup.sha256) { throw 'Backup hash differs' }
if (Get-NetTCPConnection -LocalPort 55439 -State Listen -ErrorAction SilentlyContinue) { throw 'Audit port already occupied' }
$auditDirectory = Join-Path $auditOutput ('restore-audit-' + (Get-Date -Format 'yyyyMMddTHHmmss'))
if (Test-Path -LiteralPath $auditDirectory) { throw 'Audit path already exists' }
New-Item -ItemType Directory -Path $auditDirectory | Out-Null
$auditData = Join-Path $auditDirectory 'data'
$auditBin = 'C:\Program Files\PostgreSQL\17\bin'
$auditStarted = $false
$auditPassed = $false
$auditCounts = @{}
try {
    # Public project data only, loopback-only temporary instance, no Windows service.
    & (Join-Path $auditBin 'initdb.exe') -D $auditData --encoding=UTF8 --locale=C --username=migration_restore_audit --auth=trust
    if ($LASTEXITCODE -ne 0) { throw 'Audit initdb failed' }
    & (Join-Path $auditBin 'pg_ctl.exe') -D $auditData -l (Join-Path $auditDirectory 'postgres.log') -o '-h 127.0.0.1 -p 55439' -w -t 30 start
    if ($LASTEXITCODE -ne 0) { throw 'Audit server failed to start' }
    $auditStarted = $true
    & (Join-Path $auditBin 'pg_restore.exe') -h 127.0.0.1 -p 55439 -U migration_restore_audit -d postgres --no-owner --no-privileges --exit-on-error $auditBackup
    if ($LASTEXITCODE -ne 0) { throw 'Isolated restore failed' }
    foreach ($table in $auditReport.tableCounts.PSObject.Properties) {
        if ($table.Name -notmatch '^[a-z_]+$') { throw 'Unexpected table name' }
        $countText = & (Join-Path $auditBin 'psql.exe') -X -h 127.0.0.1 -p 55439 -U migration_restore_audit -d postgres -At -v ON_ERROR_STOP=1 -c ('SELECT count(*) FROM website_data.' + $table.Name)
        if ($LASTEXITCODE -ne 0) { throw 'Restored table count query failed' }
        $auditCounts[$table.Name] = [long]$countText
        if ([long]$countText -ne [long]$table.Value) { throw ('Restored row count differs: ' + $table.Name) }
    }
    $hashErrors = & (Join-Path $auditBin 'psql.exe') -X -h 127.0.0.1 -p 55439 -U migration_restore_audit -d postgres -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM website_data.carbon_emission_frames WHERE frame_sha256 <> encode(sha256(frame_data),'hex')"
    if ($LASTEXITCODE -ne 0 -or [long]$hashErrors -ne 0) { throw 'Restored carbon payload hash differs' }
    $auditPassed = $true
} finally {
    if ($auditStarted) {
        & (Join-Path $auditBin 'pg_ctl.exe') -D $auditData -w -t 30 -m fast stop
        if ($LASTEXITCODE -ne 0) { throw 'Audit instance did not stop; inspect its explicit data directory' }
    }
    $auditResult = @{ checkedAt=[DateTime]::UtcNow.ToString('o'); passed=$auditPassed; backupFile=$auditBackup; dataDirectory=$auditData; tableCounts=$auditCounts; temporaryInstanceStopped=$auditStarted }
    $auditResult | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $auditOutput 'restore-verification.json') -Encoding utf8
}
if ($auditPassed) {
    $auditReport.backup.isolatedRestoreTest = $true
    $auditReport.backup | Add-Member -NotePropertyName restoreTestReport -NotePropertyValue (Join-Path $auditOutput 'restore-verification.json') -Force
    $auditReport | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $auditReportPath -Encoding utf8
    Write-Output 'Isolated restore passed: all 17 table counts and carbon hashes match; temporary instance stopped.'
}
