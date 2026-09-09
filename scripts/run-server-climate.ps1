param([ValidateSet('probe','start','status','import-probe','runtime-probe','runtime-setup')][string]$Mode='probe',[ValidateRange(1,20)][int]$Checks=1)
$ErrorActionPreference='Stop'
$climateSecret=Read-Host 'PG management password (hidden)' -AsSecureString
$climatePtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($climateSecret)
try {
 $env:MIGRATION_ADMIN_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($climatePtr)
 if($Mode -ne 'status' -and $Checks -ne 1){throw 'Repeated calls allowed only for read-only status'}
 for($check=0;$check -lt $Checks;$check++){
  & 'C:\Users\53472\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' (Join-Path $PSScriptRoot 'server-climate-control.mjs') $Mode
  if($LASTEXITCODE -ne 0){throw 'Climate operation failed; see diagnostic above'}
  if($check+1 -lt $Checks){Start-Sleep -Seconds 30}
 }
} finally {
 $env:MIGRATION_ADMIN_PASSWORD=$null
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($climatePtr)
 $climateSecret.Dispose()
}
