Set-StrictMode -Version Latest

function Get-GitRepositoryRoot {
    $root = & git rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
        throw "Not inside a git repository."
    }

    return $root.Trim()
}

function Test-TcpPortOpen {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ComputerName,

        [Parameter(Mandatory = $true)]
        [int]$Port,

        [int]$TimeoutMs = 250
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync($ComputerName, $Port)
        if (-not $task.Wait($TimeoutMs)) {
            return $false
        }

        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Test-GitProxyUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProxyUrl
    )

    if ([string]::IsNullOrWhiteSpace($ProxyUrl)) {
        return $false
    }

    $uri = $null
    if (-not [Uri]::TryCreate($ProxyUrl, [UriKind]::Absolute, [ref]$uri)) {
        return $false
    }

    if ($uri.IsDefaultPort -or $uri.Port -le 0) {
        return $false
    }

    return Test-TcpPortOpen -ComputerName $uri.Host -Port $uri.Port
}

function Get-GitProxyCandidates {
    param(
        [string]$ProxyUrl,
        [string[]]$ProxyCandidates
    )

    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($ProxyUrl)) {
        $candidates.Add($ProxyUrl)
    }

    foreach ($candidate in @($ProxyCandidates)) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $candidates.Add($candidate)
        }
    }

    foreach ($candidate in @(
        $env:HTTPS_PROXY
        $env:HTTP_PROXY
        $env:ALL_PROXY
        $env:https_proxy
        $env:http_proxy
        $env:all_proxy
        'http://127.0.0.1:7890'
        'http://127.0.0.1:7891'
        'http://127.0.0.1:10809'
        'socks5://127.0.0.1:1080'
        'socks5://127.0.0.1:10808'
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $candidates.Add($candidate)
        }
    }

    return $candidates | Select-Object -Unique
}

function Get-AvailableGitProxy {
    param(
        [string]$ProxyUrl,
        [string[]]$ProxyCandidates
    )

    foreach ($candidate in (Get-GitProxyCandidates -ProxyUrl $ProxyUrl -ProxyCandidates $ProxyCandidates)) {
        if (Test-GitProxyUrl -ProxyUrl $candidate) {
            return $candidate
        }
    }

    return $null
}

function Invoke-GitCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args,

        [string]$ProxyUrl,

        [string[]]$ProxyCandidates
    )

    $proxy = Get-AvailableGitProxy -ProxyUrl $ProxyUrl -ProxyCandidates $ProxyCandidates
    if ($proxy) {
        & git -c "http.proxy=$proxy" -c "https.proxy=$proxy" @Args
    }
    else {
        & git @Args
    }

    return $LASTEXITCODE
}

function Invoke-GitInRepository {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args,

        [string]$ProxyUrl,

        [string[]]$ProxyCandidates
    )

    $root = Get-GitRepositoryRoot
    Push-Location $root
    try {
        return Invoke-GitCommand -Args $Args -ProxyUrl $ProxyUrl -ProxyCandidates $ProxyCandidates
    }
    finally {
        Pop-Location
    }
}

function Invoke-GitPushWithCommit {
    param(
        [string]$CommitMessage,

        [string]$ProxyUrl,

        [string[]]$ProxyCandidates
    )

    $root = Get-GitRepositoryRoot
    Push-Location $root
    try {
        $status = & git status --porcelain
        if ($LASTEXITCODE -ne 0) {
            return $LASTEXITCODE
        }

        if ($status) {
            if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
                throw "Working tree has changes. Provide -CommitMessage before pushing."
            }

            & git add -A
            if ($LASTEXITCODE -ne 0) {
                return $LASTEXITCODE
            }

            & git commit -m $CommitMessage
            if ($LASTEXITCODE -ne 0) {
                return $LASTEXITCODE
            }
        }

        return Invoke-GitCommand -Args @('push') -ProxyUrl $ProxyUrl -ProxyCandidates $ProxyCandidates
    }
    finally {
        Pop-Location
    }
}
