param(
    [string]$CommitMessage,
    [string]$ProxyUrl,
    [string[]]$ProxyCandidates
)

. "$PSScriptRoot\GitOps.ps1"

$exitCode = Invoke-GitPushWithCommit -CommitMessage $CommitMessage -ProxyUrl $ProxyUrl -ProxyCandidates $ProxyCandidates
exit $exitCode
