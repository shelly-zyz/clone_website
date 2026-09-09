param([ValidateSet('restore','verify','finalize','backup')][string]$Mode = 'restore')
$ErrorActionPreference = 'Stop'
$migrationRepo = Split-Path -Parent $PSScriptRoot
$migrationPassword = Read-Host 'New PG application password (hidden)' -AsSecureString
$migrationPasswordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($migrationPassword)
$migrationAwake = $false
try {
    if ($Mode -eq 'backup') {
        if (-not ('MigrationPowerState' -as [type])) {
            Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class MigrationPowerState {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@
        }
        $migrationAwake = [MigrationPowerState]::SetThreadExecutionState([uint32]2147483649) -ne 0
        if (-not $migrationAwake) { throw 'Could not request temporary system-awake state' }
        Write-Output 'Automatic system sleep temporarily inhibited for backup; power plan unchanged.'
    }
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($migrationPasswordPtr)
    $env:PGHOST = '218.197.118.49'
    $env:PGPORT = '5432'
    $env:PGDATABASE = 'zyz'
    $env:PGUSER = 'zyz'
    $env:PGSSLMODE = 'disable'
    $env:PGCONNECT_TIMEOUT = '15'
    $env:DATABASE_URL = 'postgresql://zyz:' + [Uri]::EscapeDataString($env:PGPASSWORD) + '@218.197.118.49:5432/zyz'
    $env:DATABASE_SSL = 'false'
    $env:GISPO_SOURCE_DIR = Join-Path (Split-Path $migrationRepo -Parent) 'data\gispo-vre-potential'
    $env:DATA_IMPORT_SKIP_RAW_CATALOG = 'true'
    $env:DATA_IMPORT_INCLUDE_FULL_GEOJSON = 'false'
    $migrationEntry = if ($Mode -eq 'backup') { 'backup-new-pg.mjs' } else { 'run-new-pg-migration.mjs' }
    & 'C:\Users\53472\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' (Join-Path $PSScriptRoot $migrationEntry) $Mode
    if ($LASTEXITCODE -ne 0) { throw "Migration stopped with exit code $LASTEXITCODE; completed batches retained." }
} finally {
    if ($migrationAwake) { [void][MigrationPowerState]::SetThreadExecutionState([uint32]2147483648) }
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($migrationPasswordPtr)
    $env:PGPASSWORD = $null
    $env:DATABASE_URL = $null
    $migrationPassword.Dispose()
}
