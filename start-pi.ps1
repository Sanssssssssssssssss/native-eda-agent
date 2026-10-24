$PiArgs = $args
$ErrorActionPreference = 'Stop'
$workspace = $PSScriptRoot
$entry = Join-Path $workspace 'node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js'
if (-not (Test-Path -LiteralPath $entry)) { throw 'Run npm ci --ignore-scripts in this directory first.' }
$previousAgentDir = $env:PI_CODING_AGENT_DIR
Push-Location -LiteralPath $workspace
try {
    $env:PI_CODING_AGENT_DIR = Join-Path $workspace '.pi-state'
    if ($PiArgs.Count -gt 0 -and $PiArgs[0] -in @('mcp','auth','install','remove','uninstall','update','list','config')) {
        & node $entry @PiArgs
    } else {
        $edaConfig = Get-Content -LiteralPath (Join-Path $workspace '.eda\config.json') -Raw | ConvertFrom-Json
        if ($edaConfig.model_api_enabled -ne $true) { throw 'Model API is disabled in .eda/config.json. Use eda.ps1 benchmark, verify, knowledge, trace or runs.' }
        & node $entry --approve @PiArgs
    }
    $resultCode = $LASTEXITCODE
} finally {
    $env:PI_CODING_AGENT_DIR = $previousAgentDir
    Pop-Location
}
exit $resultCode
