param([ValidateSet('stage','canary','full','status')][string]$Mode='status')
$ErrorActionPreference='Stop';$adminSecret=Read-Host 'PG management password (hidden)' -AsSecureString;$appSecret=$null
if($Mode -in @('canary','full')){$appSecret=Read-Host 'PG application password (hidden)' -AsSecureString}
$adminPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecret);$appPtr=[IntPtr]::Zero
try{
 $env:MIGRATION_ADMIN_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPtr)
 if($null -ne $appSecret){$appPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($appSecret);$env:MIGRATION_APP_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($appPtr)}
 & 'C:\Users\53472\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' (Join-Path $PSScriptRoot 'server-climate-import-control.mjs') $Mode
 if($LASTEXITCODE -ne 0){throw 'Server climate import operation failed'}
}finally{$env:MIGRATION_ADMIN_PASSWORD=$null;$env:MIGRATION_APP_PASSWORD=$null;[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPtr);if($appPtr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($appPtr)};$adminSecret.Dispose();if($null -ne $appSecret){$appSecret.Dispose()}}
