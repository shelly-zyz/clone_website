param(
 [Parameter(Mandatory=$true)][ValidateSet('canary','full')][string]$Mode,
 [Parameter(Mandatory=$true)][string]$CodeDir
)
$ErrorActionPreference='Stop'
$root='D:\energy-platform-data\climate\gfdl-esm4\ssp126\zenodo-20501729'
$runtime='D:\energy-platform-runtime\climate-import-python313\Scripts\python.exe'
$statePath=Join-Path $root 'import-state.json'
$lock=$null;$child=$null;$state=$null;$utf8=New-Object Text.UTF8Encoding($false)
function Save-State {
 $state.updatedAt=[DateTime]::UtcNow.ToString('o');$pending=$statePath+'.pending'
 [IO.File]::WriteAllText($pending,($state|ConvertTo-Json -Depth 8),$utf8)
 if([IO.File]::Exists($statePath)){[IO.File]::Replace($pending,$statePath,(Join-Path $root 'import-state.previous.json'))}else{[IO.File]::Move($pending,$statePath)}
}
try {
 $password=[Console]::In.ReadLine()
 if([string]::IsNullOrEmpty($password)){throw 'Missing process credential'}
 if(!(Test-Path -LiteralPath $runtime)){throw 'Isolated Python runtime is absent'}
 $codeFull=[IO.Path]::GetFullPath($CodeDir);$codeRoot=[IO.Path]::GetFullPath('D:\energy-platform-runtime\climate-import-code')
 if(!$codeFull.StartsWith($codeRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Code directory is outside fixed root'}
 $required=@('scripts\import-zenodo-climate-projection.py','scripts\import-all-pending-zenodo-climate.py','scripts\finalize-climate-import.py','scripts\database-schema.sql')
 foreach($relative in $required){if(!(Test-Path -LiteralPath (Join-Path $codeFull $relative))){throw ('Missing staged file: '+$relative)}}
 $parent=[IO.DirectoryInfo]$codeFull;while($null -ne $parent){if($parent.Exists -and (($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'Reparse point in code path'};$parent=$parent.Parent}
 $lock=[IO.File]::Open((Join-Path $root '.import.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $env:DATABASE_URL='postgresql://zyz:'+([Uri]::EscapeDataString($password))+'@127.0.0.1:5432/zyz';$password=$null;$env:DATABASE_SSL='false'
 $tag=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ');$log=Join-Path $root ('import-'+$Mode+'-'+$tag+'.log');$err=$log+'.err'
 $state=@{status='running';mode=$Mode;processId=$PID;codeDir=$codeFull;log=$log;startedAt=[DateTime]::UtcNow.ToString('o');updatedAt='';sourceFilesPreserved=$true};Save-State
 if($Mode -eq 'canary'){
  $program=Join-Path $codeFull 'scripts\import-zenodo-climate-projection.py'
  $arguments=@($program,'--file','gfdl-esm4_ssp126_rsds_2021_2030.nc','--scratch-dir',$root,'--limit-days','1','--keep-netcdf')
 } else {
  $program=Join-Path $codeFull 'scripts\import-all-pending-zenodo-climate.py'
  $arguments=@($program,'--max-retries','2','--checkpoint-days','155')
 }
 $child=Start-Process -FilePath $runtime -ArgumentList $arguments -WorkingDirectory $codeFull -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
 if($child.ExitCode -ne 0){throw ('Importer exited '+$child.ExitCode+': '+(@(Get-Content -LiteralPath $err -Tail 20)-join ' '))}
 $state.status='complete';$state.finishedAt=[DateTime]::UtcNow.ToString('o');Save-State
}catch{
 if($null -ne $state){$state.status='failed';$state.error=$_.Exception.Message;Save-State}
 [Console]::Error.WriteLine($_.Exception.Message);exit 1
}finally{
 $env:DATABASE_URL=$null;$env:DATABASE_SSL=$null;$password=$null
 if($null -ne $lock){$lock.Dispose()}
}
