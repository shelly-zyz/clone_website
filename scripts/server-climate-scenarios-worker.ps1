param(
 [Parameter(Mandatory=$true)][string]$ManifestPath,
 [Parameter(Mandatory=$true)][string]$CodeDir
)
$ErrorActionPreference='Stop'
$root='D:\energy-platform-data\climate\gfdl-esm4\ssp245-370-585'
$curl='C:\Windows\System32\curl.exe'
$runtime='D:\energy-platform-runtime\climate-import-python313\Scripts\python.exe'
$pipelineStatePath=Join-Path $root 'pipeline-state.json'
$lock=$null;$child=$null;$state=$null;$password=$null
$utf8=New-Object Text.UTF8Encoding($false)

function Save-State {
 $state.updatedAt=[DateTime]::UtcNow.ToString('o')
 $pending=$pipelineStatePath+'.pending'
 [IO.File]::WriteAllText($pending,($state|ConvertTo-Json -Depth 12),$utf8)
 if([IO.File]::Exists($pipelineStatePath)){[IO.File]::Replace($pending,$pipelineStatePath,(Join-Path $root 'pipeline-state.previous.json'))}else{[IO.File]::Move($pending,$pipelineStatePath)}
}
function Assert-Target([string]$p) {
 $resolved=[IO.Path]::GetFullPath($p)
 if([IO.Path]::GetDirectoryName($resolved) -ne $root){throw "File target escapes dataset directory: $p"}
 if((Test-Path -LiteralPath $resolved) -and (((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'Reparse file target rejected'}
}
function Quarantine([string]$p) {
 Assert-Target $p
 $destination=$p+'.rejected-'+[Guid]::NewGuid().ToString('N')
 Assert-Target $destination
 [IO.File]::Move($p,$destination)
 $state.quarantined+=@{path=$destination;reason='size-or-checksum-mismatch';at=[DateTime]::UtcNow.ToString('o')}
 Save-State
}
function Add-Completed($f) {
 $map=@{}
 foreach($item in @($state.completed)){if($null -ne $item.file){$map[[string]$item.file]=$item}}
 $map[[string]$f.file]=$f
 $state.completed=@($map.Values|Sort-Object file)
}
function File-Is-Verified($f,[string]$path) {
 if(!(Test-Path -LiteralPath $path)){return $false}
 $item=Get-Item -LiteralPath $path
 if($item.Length -ne [long]$f.bytes){return $false}
 return (Get-FileHash -LiteralPath $path -Algorithm MD5).Hash.ToLowerInvariant() -eq $f.checksum.Substring(4)
}
try {
 [IO.Directory]::CreateDirectory($root)|Out-Null
 if(!(Test-Path -LiteralPath $curl)){throw 'Windows curl unavailable'}
 if(!(Test-Path -LiteralPath $runtime)){throw 'Climate import runtime is absent'}
 if(!(Test-Path -LiteralPath $ManifestPath)){throw "Manifest is absent: $ManifestPath"}
 $password=[Console]::In.ReadLine();if([string]::IsNullOrEmpty($password)){throw 'Missing PostgreSQL application password'}
 $manifest=Get-Content -LiteralPath $ManifestPath -Raw|ConvertFrom-Json
 $files=@($manifest.files)
 $nc=@($files|Where-Object {$_.kind -eq 'climate_netcdf'})
 $mat=@($files|Where-Object {$_.kind -eq 'vre_mat'})
 if($nc.Count -ne 60 -or $mat.Count -ne 3 -or $files.Count -ne 63){throw "Expected 60 NetCDF + 3 MAT files, got $($nc.Count) + $($mat.Count)"}
 foreach($f in $files){
  if($f.filename -notmatch '^[A-Za-z0-9._-]+$'){throw "Invalid filename: $($f.filename)"}
  if($f.checksum -notmatch '^md5:[a-f0-9]{32}$'){throw "Invalid checksum: $($f.filename)"}
  if([long]$f.bytes -lt 1 -or [long]$f.bytes -gt 7000000000){throw "Unexpected file size: $($f.filename)"}
  if($f.download_url -notmatch '^https://zenodo\.org/api/records/[0-9]+/files/.+/content$'){throw "Untrusted source URL: $($f.filename)"}
 }
 $totalBytes=([long]($files|Measure-Object bytes -Sum).Sum)
 $lock=[IO.File]::Open((Join-Path $root '.download.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 if(Test-Path -LiteralPath $pipelineStatePath){
  try{$state=Get-Content -LiteralPath $pipelineStatePath -Raw|ConvertFrom-Json|ConvertTo-Json -Depth 12|ConvertFrom-Json}catch{$state=$null}
 }
 if($null -eq $state){$state=@{status='starting';phase='downloading';processId=$PID;directory=$root;model='GFDL-ESM4';scenarios=@('ssp245','ssp370','ssp585');startedAt=[DateTime]::UtcNow.ToString('o');updatedAt='';totalFiles=$files.Count;totalBytes=$totalBytes;completed=@();failed=@();quarantined=@();current=$null;databaseImported=$false}}
 $state.status='running';$state.phase='downloading';$state.processId=$PID;$state.directory=$root;$state.totalFiles=$files.Count;$state.totalBytes=$totalBytes;$state.failed=@();Save-State
 foreach($f in ($files|Sort-Object bytes,filename)){
  $final=Join-Path $root $f.filename;$partial=$final+'.part'
  Assert-Target $final;Assert-Target $partial
  $expected=$f.checksum.Substring(4);$passed=$false;$lastError=''
  try{
   if(File-Is-Verified $f $final){$passed=$true}else{if(Test-Path -LiteralPath $final){Quarantine $final}}
   if(!$passed){
    if((Test-Path -LiteralPath $partial) -and (Get-Item -LiteralPath $partial).Length -gt [long]$f.bytes){Quarantine $partial}
    for($attempt=1;$attempt -le 3 -and !$passed;$attempt++){
     try{
      $offset=if(Test-Path -LiteralPath $partial){(Get-Item -LiteralPath $partial).Length}else{0}
      if($offset -gt [long]$f.bytes){Quarantine $partial;$offset=0}
      if((Get-PSDrive D).Free -lt ([long]$f.bytes-$offset+2GB)){throw 'Insufficient free disk space'}
      $state.current=@{file=$f.filename;kind=$f.kind;bytes=[long]$offset;expectedBytes=[long]$f.bytes;attempt=$attempt;phase='downloading'};Save-State
      $tag=[Guid]::NewGuid().ToString('N')
      $argsList=@('--fail','--location','--proto','=https','--proto-redir','=https','--silent','--show-error','--continue-at','-','--connect-timeout','30','--max-time','14400','--speed-limit','1024','--speed-time','300','--retry','5','--retry-delay','15','--retry-max-time','1200','--output',$partial,$f.download_url)
      $child=Start-Process -FilePath $curl -ArgumentList $argsList -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root ('curl-'+$tag+'.out.log')) -RedirectStandardError (Join-Path $root ('curl-'+$tag+'.err.log'))
      $null=$child.Handle
      while(!$child.WaitForExit(10000)){$state.current.bytes=if(Test-Path -LiteralPath $partial){(Get-Item -LiteralPath $partial).Length}else{0};Save-State}
      $child.Refresh();$exitCode=$child.ExitCode;$child=$null
      if($null -eq $exitCode -or $exitCode -ne 0){throw ('curl failed with exit '+$exitCode+'; partial retained')}
      if(!(Test-Path -LiteralPath $partial) -or (Get-Item -LiteralPath $partial).Length -ne [long]$f.bytes){throw 'Downloaded byte count mismatch'}
      $state.current.phase='checksum';$state.current.bytes=[long]$f.bytes;Save-State
      $actual=(Get-FileHash -LiteralPath $partial -Algorithm MD5).Hash.ToLowerInvariant()
      if($actual -ne $expected){Quarantine $partial;throw "Official MD5 mismatch: expected $expected, got $actual"}
      [IO.File]::Move($partial,$final);$passed=$true
     }catch{
      $lastError=$_.Exception.Message
      if($attempt -lt 3){
       $retryOffset=if(Test-Path -LiteralPath $partial){(Get-Item -LiteralPath $partial).Length}else{0}
       $state.current=@{file=$f.filename;kind=$f.kind;bytes=[long]$retryOffset;expectedBytes=[long]$f.bytes;attempt=$attempt;phase='retrying';error=$lastError};Save-State
       Start-Sleep -Seconds ([Math]::Min(60,15*$attempt))
      }else{throw}
     }
    }
   }
   if(!$passed){throw "Could not verify $($f.filename): $lastError"}
   Add-Completed @{file=$f.filename;kind=$f.kind;bytes=[long]$f.bytes;md5=$expected;verifiedAt=[DateTime]::UtcNow.ToString('o')}
   $state.current=$null;Save-State
  }catch{
   $lastError=$_.Exception.Message;$state.failed+=@{file=$f.filename;error=$lastError};$state.current=@{file=$f.filename;phase='failed';error=$lastError};Save-State;throw
  }
 }
 $state.phase='importing';$state.current=$null;Save-State
 $codeFull=[IO.Path]::GetFullPath($CodeDir);$codeRoot=[IO.Path]::GetFullPath('D:\energy-platform-runtime\climate-import-code')
 if(!$codeFull.StartsWith($codeRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Code directory is outside fixed root'}
 $program=Join-Path $codeFull 'scripts\import-selected-zenodo-climate-scenarios.py'
 if(!(Test-Path -LiteralPath $program)){throw 'Scenario importer is absent'}
 $env:DATABASE_URL='postgresql://zyz:'+([Uri]::EscapeDataString($password))+'@127.0.0.1:5432/zyz';$env:DATABASE_SSL='false';$password=$null
 $tag=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ');$log=Join-Path $root ('import-scenarios-'+$tag+'.log');$err=$log+'.err'
 $state.importProcessId=$PID;$state.importLog=$log;Save-State
 $arguments=@($program,'--manifest',(Join-Path $root 'download-manifest.json'),'--scratch-dir',$root,'--state-path',(Join-Path $root 'import-state.json'),'--max-retries','2')
 $child=Start-Process -FilePath $runtime -ArgumentList $arguments -WorkingDirectory $codeFull -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
 if($child.ExitCode -ne 0){throw ('Scenario importer exited '+$child.ExitCode+': '+(@(Get-Content -LiteralPath $err -Tail 40)-join ' '))}
 $state.status='complete';$state.phase='complete';$state.databaseImported=$true;$state.finishedAt=[DateTime]::UtcNow.ToString('o');Save-State
}catch{
 if($null -ne $state){$state.status='failed';$state.error=$_.Exception.Message;Save-State}
 [Console]::Error.WriteLine($_.Exception.Message);exit 1
}finally{
 if($null -ne $child -and !$child.HasExited){$child.Kill()}
 $env:DATABASE_URL=$null;$env:DATABASE_SSL=$null;$password=$null
 if($null -ne $lock){$lock.Dispose()}
}
