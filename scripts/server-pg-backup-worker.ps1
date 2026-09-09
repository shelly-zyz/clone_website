$ErrorActionPreference='Stop'
$b='D:\pgsql\pgsql\bin';$d='D:\pgbackups';$id='__BACKUP_ID__'
$p=Join-Path $d ($id+'.incomplete.dump');$f=Join-Path $d ($id+'.dump');$r=Join-Path $d ($id+'.report.json')
$result=@{status='failed';file=$p;isolatedRestoreTest=$false};$canWrite=$false
function Run($name,$av,$tag){
 $err=$r+'.'+$tag+'.err'
 $x=Start-Process -FilePath "$b\$name" -ArgumentList $av -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput ($r+'.'+$tag+'.out') -RedirectStandardError $err
 if($x.ExitCode -ne 0){throw ($name+': '+(Get-Content -LiteralPath $err -Raw))}
}
try {
 $env:PGPASSWORD=[Console]::In.ReadLine()
 if([string]::IsNullOrEmpty($env:PGPASSWORD)){throw 'Missing process credential'}
 if(!(Test-Path -LiteralPath $d)){New-Item -ItemType Directory -Path $d | Out-Null}
 if((Test-Path -LiteralPath $p) -or (Test-Path -LiteralPath $f) -or (Test-Path -LiteralPath $r)){throw 'Backup target exists'}
 $canWrite=$true
 Run 'pg_dump.exe' @('-h','127.0.0.1','-p','5432','-U','zyz','-d','zyz','-w','-Fc','--no-owner','--no-privileges','-f',$p) 'dump'
 Run 'pg_restore.exe' @('--list',$p) 'list'
 Run 'pg_restore.exe' @('--file=NUL',$p) 'read'
 if((Get-Item -LiteralPath $p).DirectoryName -ne $d){throw 'Unexpected backup directory'}
 Move-Item -LiteralPath $p -Destination $f
 $result=@{status='complete';file=$f;bytes=(Get-Item -LiteralPath $f).Length;sha256=(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash;archiveListVerified=$true;allArchiveBlocksRead=$true;isolatedRestoreTest=$false;location='target-server';completedAt=[DateTime]::UtcNow.ToString('o')}
} catch {$result.error=$_.Exception.Message}
finally {$env:PGPASSWORD=$null;if($canWrite){$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $r -Encoding UTF8}}
exit 0
