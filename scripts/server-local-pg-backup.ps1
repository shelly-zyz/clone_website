# Run on the target Windows server, not on the client computer.
$ErrorActionPreference='Stop'
$serverPgBin='D:\pgsql\pgsql\bin'
if(!(Test-Path -LiteralPath (Join-Path $serverPgBin 'pg_dump.exe'))){throw 'Target server PostgreSQL executable not found'}
$serverBackupDir='D:\pgbackups'
if(!(Test-Path -LiteralPath $serverBackupDir)){New-Item -ItemType Directory -Path $serverBackupDir | Out-Null}
$serverStamp=Get-Date -Format 'yyyyMMddTHHmmss'
$serverPartial=Join-Path $serverBackupDir ('zyz-'+$serverStamp+'.incomplete.dump')
$serverComplete=Join-Path $serverBackupDir ('zyz-'+$serverStamp+'.dump')
if((Test-Path -LiteralPath $serverPartial) -or (Test-Path -LiteralPath $serverComplete)){throw 'Backup path already exists; nothing overwritten'}
& (Join-Path $serverPgBin 'pg_dump.exe') -h 127.0.0.1 -p 5432 -U zyz -d zyz -W --format=custom --no-owner --no-privileges --file $serverPartial
if($LASTEXITCODE -ne 0){throw 'Backup failed; incomplete file retained, database not changed'}
& (Join-Path $serverPgBin 'pg_restore.exe') --list $serverPartial | Out-Null
if($LASTEXITCODE -ne 0){throw 'Backup directory verification failed'}
& (Join-Path $serverPgBin 'pg_restore.exe') --file=NUL $serverPartial
if($LASTEXITCODE -ne 0){throw 'Backup archive block verification failed'}
if((Get-Item -LiteralPath $serverPartial).DirectoryName -ne $serverBackupDir){throw 'Unexpected backup directory'}
Move-Item -LiteralPath $serverPartial -Destination $serverComplete
[pscustomobject]@{File=$serverComplete;Bytes=(Get-Item -LiteralPath $serverComplete).Length;SHA256=(Get-FileHash -LiteralPath $serverComplete -Algorithm SHA256).Hash;ArchiveBlocksVerified=$true;IsolatedRestoreTest=$false} | Format-List
