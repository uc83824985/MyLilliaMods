param([int]$Seed = 42, [ValidateRange(0,36000)][int]$Steps = 600, [string]$Policy = 'adaptive', [string]$OutputPath, [int]$DebugPort = 9222)
$ErrorActionPreference = 'Stop'
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot '../../artifacts/chase-lab/checkpoint.png' }
$capturePath = [System.IO.Path]::GetFullPath($OutputPath)
# Reuse an existing local debugging connection; never launch a browser or make a profile.
node (Join-Path $PSScriptRoot 'capture.mjs') --seed $Seed --steps $Steps --policy $Policy --output $capturePath --debug-port $DebugPort
if ($LASTEXITCODE -ne 0) { throw 'Checkpoint capture failed; see the diagnostic above. Simulation jobs are unaffected.' }
