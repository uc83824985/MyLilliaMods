param(
    [ValidateSet('bench','train')][string]$Mode = 'bench',
    [ValidateRange(1,1000)][int]$Seeds = 12,
    [ValidateRange(1,128)][int]$Candidates = 8,
    [ValidateRange(1,1000)][int]$Holdout = 24,
    [int]$Seed = 1000,
    [string]$Config,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot ('../../artifacts/chase-lab/jobs/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')) }
$jobDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $jobDirectory -Force | Out-Null
$reportPath = Join-Path $jobDirectory 'report.json'
$arguments = @('"' + (Join-Path $PSScriptRoot 'cli.mjs') + '"', $Mode, '--seeds', $Seeds, '--candidates', $Candidates, '--holdout', $Holdout, '--seed', $Seed, '--output', '"' + $reportPath + '"')
if ($Config) { $configPath = (Resolve-Path -LiteralPath $Config).Path; $arguments += @('--config', '"' + $configPath + '"') }
$process = Start-Process -FilePath (Get-Command node -ErrorAction Stop).Source -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $jobDirectory 'stdout.log') -RedirectStandardError (Join-Path $jobDirectory 'stderr.log') -PassThru
[pscustomobject]@{ PID = $process.Id; Directory = $jobDirectory; Status = (Join-Path $jobDirectory 'report.status.json'); StopFile = (Join-Path $jobDirectory 'report.stop') } | ConvertTo-Json
