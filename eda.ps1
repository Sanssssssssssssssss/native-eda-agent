$nativeArgs = $args
Push-Location -LiteralPath $PSScriptRoot
try {
    if ($nativeArgs.Count -gt 0 -and $nativeArgs[0] -eq 'chat') {
        & "$PSScriptRoot\start-pi.ps1" @($nativeArgs | Select-Object -Skip 1)
    } else {
        & node "$PSScriptRoot\src\agent.mjs" @nativeArgs
    }
    $nativeExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $nativeExitCode
