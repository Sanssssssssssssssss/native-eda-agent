$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $workspace 'runtime/vivado-community-venv'
$pythonExe = Join-Path $venv 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Python venv creation failed' }
}
& $pythonExe -m pip install -c (Join-Path $workspace 'release/python-requirements.lock') -e (Join-Path $workspace 'vendor/vivado-mcp-community')
if ($LASTEXITCODE -ne 0) { throw 'Community MCP installation failed' }
Write-Output 'Python backend ready. Vivado and model sessions were not started.'
