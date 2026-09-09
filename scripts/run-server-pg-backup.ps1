param(
 [switch]$Verify,
 [switch]$BackupAndVerify
)
$ErrorActionPreference='Stop'
$adminSecret=Read-Host 'PG management password (hidden)' -AsSecureString
$repositoryRoot=Split-Path -Parent $PSScriptRoot
$environmentFile=Join-Path $repositoryRoot '.env.local'
$databaseLine=$null
if(Test-Path -LiteralPath $environmentFile -PathType Leaf){
 $databaseLine=Get-Content -LiteralPath $environmentFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
}
if($databaseLine){
 $databaseUrl=($databaseLine -replace '^\s*DATABASE_URL\s*=\s*','').Trim().Trim('"').Trim("'")
 $databaseUri=[Uri]$databaseUrl
 $userInfo=$databaseUri.UserInfo.Split(':',2)
 if($databaseUri.AbsolutePath.Trim('/') -ne 'zyz' -or [Uri]::UnescapeDataString($userInfo[0]) -ne 'zyz' -or $userInfo.Count -ne 2){
  throw 'Configured DATABASE_URL is not the expected zyz application connection'
 }
 $appPassword=[Uri]::UnescapeDataString($userInfo[1])
 Write-Host 'PG application password: using the verified zyz connection from .env.local (not displayed)'
}else{
 $appSecret=Read-Host 'PG application password (hidden)' -AsSecureString
}
$adminPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecret)
$appPtr=[IntPtr]::Zero
try {
 $env:MIGRATION_ADMIN_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPtr)
 if($appPassword){
  $env:MIGRATION_APP_PASSWORD=$appPassword
 }else{
  $appPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($appSecret)
  $env:MIGRATION_APP_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($appPtr)
 }
 $node='C:\Users\53472\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
 $entries=if($BackupAndVerify){
  @('server-pg-backup-runner.mjs','verify-server-pg-backup.mjs')
 }elseif($Verify){
  @('verify-server-pg-backup.mjs')
 }else{
  @('server-pg-backup-runner.mjs')
 }
 foreach($entry in $entries){
  & $node (Join-Path $PSScriptRoot $entry)
  if($LASTEXITCODE -ne 0){throw "$entry did not complete; inspect its status report"}
 }
}finally{
 $env:MIGRATION_ADMIN_PASSWORD=$null;$env:MIGRATION_APP_PASSWORD=$null
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPtr)
 if($appPtr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($appPtr)}
 $appPassword=$null
 $adminSecret.Dispose()
 if($appSecret){$appSecret.Dispose()}
}
