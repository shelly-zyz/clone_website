[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$nodePath = "C:\Program Files\nodejs\node.exe"
$weatherPython = "C:\Users\53472\Desktop\studying\clone_website\outputs\20260904-pg-migration\venv\Scripts\python.exe"
$syncScript = Join-Path $PSScriptRoot "sync-live-weather.mjs"

foreach ($requiredPath in @($nodePath, $weatherPython, $syncScript)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required weather-sync component is missing: $requiredPath"
    }
}

$env:WEATHER_PYTHON = $weatherPython
Set-Location -LiteralPath $repositoryRoot

& $nodePath $syncScript
if ($LASTEXITCODE -ne 0) {
    throw "Live weather sync failed with exit code $LASTEXITCODE."
}
