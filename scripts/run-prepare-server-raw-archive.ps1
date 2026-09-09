$ErrorActionPreference='Stop'
$adminSecret=Read-Host 'PG management password (hidden)' -AsSecureString
$appSecret=Read-Host 'PG application password (hidden)' -AsSecureString
$adminPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecret)
$appPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($appSecret)
try {
 $env:MIGRATION_ADMIN_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPtr)
 $env:MIGRATION_APP_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($appPtr)
 & 'C:\Users\53472\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' (Join-Path $PSScriptRoot 'prepare-server-raw-archive.mjs')
 if($LASTEXITCODE -ne 0){throw 'Server raw archive preparation failed'}
} finally {
 $env:MIGRATION_ADMIN_PASSWORD=$null;$env:MIGRATION_APP_PASSWORD=$null
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPtr);[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($appPtr)
 $adminSecret.Dispose();$appSecret.Dispose()
}
