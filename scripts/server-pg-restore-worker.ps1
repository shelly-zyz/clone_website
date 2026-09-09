$ErrorActionPreference='Stop'
$b='D:\pgsql\pgsql\bin';$d='D:\pgbackups';$db='__AUDIT_DB__';$file='__BACKUP_FILE__'
$r=Join-Path $d ($db+'.report.json');$result=@{status='failed';database=$db}
if(Test-Path -LiteralPath $r){exit 2}
try {
 $env:PGPASSWORD=[Console]::In.ReadLine()
 if([string]::IsNullOrEmpty($env:PGPASSWORD)){throw 'Missing process credential'}
 $x=Start-Process -FilePath "$b\pg_restore.exe" -ArgumentList @('-h','127.0.0.1','-p','5432','-U','zyz','-d',$db,'-w','--no-owner','--no-privileges','--exit-on-error',$file) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput ($r+'.out') -RedirectStandardError ($r+'.err')
 if($x.ExitCode -ne 0){throw ('Restore failed: '+(Get-Content -LiteralPath ($r+'.err') -Raw))}
 $result.status='complete'
}catch{$result.error=$_.Exception.Message}
finally{$env:PGPASSWORD=$null;$result | ConvertTo-Json | Set-Content -LiteralPath $r -Encoding UTF8}
exit 0
