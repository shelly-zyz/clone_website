param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference='Stop'
$root='D:\energy-platform-data\climate\gfdl-esm4\ssp126\zenodo-20501729'
$curl='C:\Windows\System32\curl.exe'
$lock=$null
$child=$null
$state=$null
$statePath=Join-Path $root 'download-state.json'
$utf8=New-Object Text.UTF8Encoding($false)

function Save-State {
 $state.updatedAt=[DateTime]::UtcNow.ToString('o')
 $json=$state|ConvertTo-Json -Depth 10
 $pending=$statePath+'.pending'
 [IO.File]::WriteAllText($pending,$json,$utf8)
 if([IO.File]::Exists($statePath)){[IO.File]::Replace($pending,$statePath,(Join-Path $root 'download-state.previous.json'))}else{[IO.File]::Move($pending,$statePath)}
}
function Assert-Target([string]$p) {
 $resolved=[IO.Path]::GetFullPath($p)
 if([IO.Path]::GetDirectoryName($resolved) -ne $root){throw 'File target escapes dataset directory'}
 if((Test-Path -LiteralPath $resolved) -and (((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'Reparse file target rejected'}
}
function Quarantine([string]$p) {
 Assert-Target $p
 $destination=$p+'.rejected-'+[Guid]::NewGuid().ToString('N')
 Assert-Target $destination
 [IO.File]::Move($p,$destination)
 $state.quarantined+=@{path=$destination;reason='size-or-checksum-mismatch';at=[DateTime]::UtcNow.ToString('o')}
}
try {
 if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ManifestPath)) -ne $root){throw 'Manifest location mismatch'}
 $parent=[IO.DirectoryInfo]$root
 while($null -ne $parent){if($parent.Exists -and (($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'Reparse directory rejected'};$parent=$parent.Parent}
 if(!(Test-Path -LiteralPath $curl)){throw 'Windows curl unavailable'}
 $manifest=Get-Content -LiteralPath $ManifestPath -Raw|ConvertFrom-Json
 $files=@($manifest.files)
 if($files.Count -ne 20 -or @($files.filename|Sort-Object -Unique).Count -ne 20){throw 'Expected 20 unique climate files'}
 foreach($f in $files){
  if($f.filename -notmatch '^gfdl-esm4_ssp126_(huss|rsds|tas|sfcwind|ps)_(2021_2030|2031_2040|2041_2050|2051_2060)\.nc$' -or $f.checksum -notmatch '^md5:[a-f0-9]{32}$'){throw 'Invalid manifest entry'}
  if($f.download_url -cne ('https://zenodo.org/api/records/20501729/files/'+$f.filename+'/content')){throw 'Source URL mismatch'}
  if([long]$f.bytes -lt 1 -or [long]$f.bytes -gt 2000000000){throw 'Unexpected file size'}
 }
 if(($files|Measure-Object bytes -Sum).Sum -ne 21524120425){throw 'Dataset size mismatch'}
 $lock=[IO.File]::Open((Join-Path $root '.download.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $state=@{status='running';processId=$PID;directory=$root;model='GFDL-ESM4';scenario='ssp126';version='20501729';truthStatus='published-model-scenario-not-observation';startedAt=[DateTime]::UtcNow.ToString('o');updatedAt='';totalFiles=20;totalBytes=21524120425;completed=@();failed=@();quarantined=@();current=$null;databaseImported=$false}
 Save-State
 # Small radiation files first; one connection at a time limits load and rate limits.
 foreach($f in ($files|Sort-Object bytes,filename)){
  $final=Join-Path $root $f.filename
  $partial=$final+'.part'
  Assert-Target $final
  Assert-Target $partial
  $expected=$f.checksum.Substring(4)
  $passed=$false
  $lastError=''
  for($attempt=1;$attempt -le 3;$attempt++){
   try {
    if(Test-Path -LiteralPath $final){
     if((Get-Item -LiteralPath $final).Length -eq [long]$f.bytes -and (Get-FileHash -LiteralPath $final -Algorithm MD5).Hash.ToLowerInvariant() -eq $expected){$passed=$true;break}
     Quarantine $final
    }
    if((Test-Path -LiteralPath $partial) -and (Get-Item -LiteralPath $partial).Length -gt [long]$f.bytes){Quarantine $partial}
    $offset=if(Test-Path -LiteralPath $partial){(Get-Item -LiteralPath $partial).Length}else{0}
    if((Get-PSDrive D).Free -lt ([long]$f.bytes-$offset+2GB)){throw 'Insufficient free disk space'}
    $state.current=@{file=$f.filename;bytes=$offset;expectedBytes=[long]$f.bytes;attempt=$attempt;phase='downloading'}
    Save-State
    if($offset -lt [long]$f.bytes){
     $tag=[Guid]::NewGuid().ToString('N')
     $argsList=@('--fail','--location','--proto','=https','--proto-redir','=https','--silent','--show-error','--continue-at','-','--connect-timeout','30','--max-time','7200','--speed-limit','1024','--speed-time','180','--retry','4','--retry-delay','15','--retry-max-time','600','--output',$partial,$f.download_url)
     $child=Start-Process -FilePath $curl -ArgumentList $argsList -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root ('curl-'+$tag+'.out.log')) -RedirectStandardError (Join-Path $root ('curl-'+$tag+'.err.log'))
     $null=$child.Handle
     while(!$child.WaitForExit(10000)){
      $state.current.bytes=if(Test-Path -LiteralPath $partial){(Get-Item -LiteralPath $partial).Length}else{0}
      Save-State
     }
     $child.Refresh()
     $exitCode=$child.ExitCode
     $child=$null
     if($null -eq $exitCode -or $exitCode -ne 0){throw ('curl failed with exit '+$exitCode+'; partial retained')}
    }
    if(!(Test-Path -LiteralPath $partial) -or (Get-Item -LiteralPath $partial).Length -ne [long]$f.bytes){throw 'Downloaded byte count mismatch'}
    $state.current.phase='checksum'
    $state.current.bytes=[long]$f.bytes
    Save-State
    $actual=(Get-FileHash -LiteralPath $partial -Algorithm MD5).Hash.ToLowerInvariant()
    if($actual -ne $expected){Quarantine $partial;throw 'Official MD5 mismatch; file preserved separately'}
    [IO.File]::Move($partial,$final)
    $passed=$true
    break
   }catch{
    $lastError=$_.Exception.Message
    $state.current=@{file=$f.filename;attempt=$attempt;phase='retry';error=$lastError}
    Save-State
    if($attempt -lt 3){Start-Sleep -Seconds 30}
   }
  }
  if($passed){$state.completed+=@{file=$f.filename;bytes=[long]$f.bytes;md5=$expected;verifiedAt=[DateTime]::UtcNow.ToString('o')}}else{$state.failed+=@{file=$f.filename;error=$lastError}}
  $state.current=$null
  Save-State
 }
 $state.status=if($state.failed.Count -eq 0){'complete'}else{'partial-failure'}
 $state.finishedAt=[DateTime]::UtcNow.ToString('o')
 Save-State
}catch{
 if($null -ne $state){$state.status='failed';$state.error=$_.Exception.Message;Save-State}
 [Console]::Error.WriteLine($_.Exception.Message)
 exit 1
}finally{
 if($null -ne $child -and !$child.HasExited){$child.Kill()}
 if($null -ne $lock){$lock.Dispose()}
}
