param([switch]$WithoutSystem)
$ErrorActionPreference = 'Stop'
$gameRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$modRoot = Join-Path $gameRoot 'MyLilliaMods'
$artifactRoot = Join-Path $modRoot 'artifacts'
$pluginRoot = Join-Path $gameRoot 'BepInEx/plugins'
if (Get-Process NoviceSuccubusLillia -ErrorAction SilentlyContinue) { throw '请先退出已有游戏进程，再运行隔离检查。' }
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
dotnet build (Join-Path $modRoot 'tests/ChaseRuntimeChecks/ChaseRuntimeChecks.csproj') -c Release
if ($LASTEXITCODE -ne 0) { throw 'Runtime checks build failed.' }
$testDll = Join-Path $pluginRoot 'ChaseRuntimeChecks.dll'
$systemDll = Join-Path $pluginRoot 'LilliaSystem.dll'
$systemHold = Join-Path $artifactRoot 'LilliaSystem.runtime-hold.dll'
$systemMoved = $false
$runProcess = $null
$suffix = if ($WithoutSystem) { 'without-system' } else { 'with-system' }
if (Test-Path -LiteralPath $systemHold) { throw '存在上一轮暂存的 System DLL；请检查并恢复，避免覆盖。' }
if (Test-Path -LiteralPath $testDll) { throw '已有同名运行时测试 DLL；请先检查其来源并移出插件目录。' }
try {
    Copy-Item -LiteralPath (Join-Path $modRoot 'src/LilliaChasePrototype/bin/Release/net6.0/LilliaChasePrototype.dll') -Destination (Join-Path $pluginRoot 'LilliaChasePrototype.dll')
    Copy-Item -LiteralPath (Join-Path $modRoot 'tests/ChaseRuntimeChecks/bin/Release/net6.0/ChaseRuntimeChecks.dll') -Destination $testDll
    if ($WithoutSystem -and (Test-Path -LiteralPath $systemDll)) {
        Move-Item -LiteralPath $systemDll -Destination $systemHold
        $systemMoved = $true
    }
    $unityLog = Join-Path $artifactRoot "runtime-$suffix-unity.log"
    $runProcess = Start-Process -FilePath (Join-Path $gameRoot 'NoviceSuccubusLillia.exe') -WorkingDirectory $gameRoot -ArgumentList @('-batchmode','-nosound','-logFile',('"' + $unityLog + '"')) -WindowStyle Hidden -PassThru
    if (!$runProcess.WaitForExit(55000)) { throw '运行时检查未在 55 秒内退出。' }
    $bepLog = Join-Path $gameRoot 'BepInEx/LogOutput.log'
    Copy-Item -LiteralPath $bepLog -Destination (Join-Path $artifactRoot "runtime-$suffix.log")
    $result = Get-Content -LiteralPath $bepLog -Raw
    if ($result -notmatch 'ALL \d+ CHASE RUNTIME CHECKS PASSED') { throw "Runtime checks failed. See runtime-$suffix.log." }
    ($result -split '\r?\n') | Where-Object { $_ -match 'MOTOR displacement|ALL \d+ CHASE|CONTROLLER police|disabling prototype restores original' }
} finally {
    if ($runProcess -and !$runProcess.HasExited) { Stop-Process -Id $runProcess.Id -Force; $runProcess.WaitForExit(5000) | Out-Null }
    try { if (Test-Path -LiteralPath $testDll) { Remove-Item -LiteralPath $testDll } }
    finally { if ($systemMoved -and (Test-Path -LiteralPath $systemHold)) { Move-Item -LiteralPath $systemHold -Destination $systemDll } }
}
