param(
    [string]$ProxyUrl,
    [string[]]$ProxyCandidates
)

. "$PSScriptRoot\GitOps.ps1"

$exitCode = Invoke-GitInRepository -Args @('pull') -ProxyUrl $ProxyUrl -ProxyCandidates $ProxyCandidates
exit $exitCode
