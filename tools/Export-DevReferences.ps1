param(
    [string]$BepInExRoot = (Join-Path $PSScriptRoot '../../BepInEx'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '../artifacts/lillia-dev-references.zip')
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = [IO.Path]::GetFullPath($BepInExRoot)
$archivePath = [IO.Path]::GetFullPath($OutputPath)
$projects = @('src/LilliaChasePrototype/LilliaChasePrototype.csproj', 'tests/ChaseRuntimeChecks/ChaseRuntimeChecks.csproj')
$relativeFiles = foreach ($project in $projects) {
    [xml]$projectXml = Get-Content -LiteralPath (Join-Path $repoRoot $project) -Raw
    foreach ($reference in $projectXml.Project.ItemGroup.Reference) {
        if ($reference.HintPath) {
            $relative = [string]$reference.HintPath
            if (!$relative.StartsWith('$(BepInExRoot)/')) { throw "Unexpected reference path: $relative" }
            $relative.Substring('$(BepInExRoot)/'.Length)
        }
    }
}
$relativeFiles = @($relativeFiles | Sort-Object -Unique)
foreach ($relative in $relativeFiles) {
    if (!(Test-Path -LiteralPath (Join-Path $sourceRoot $relative) -PathType Leaf)) { throw "Missing development reference: $relative" }
}
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($archivePath)) -Force | Out-Null
$temporaryArchive = $archivePath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
$archive = [IO.Compression.ZipFile]::Open($temporaryArchive, [IO.Compression.ZipArchiveMode]::Create)
try {
    $manifestFiles = foreach ($relative in $relativeFiles) {
        $source = Join-Path $sourceRoot $relative
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, ('BepInEx/' + $relative), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        @{ path = 'BepInEx/' + $relative; sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash; bytes = (Get-Item -LiteralPath $source).Length }
    }
    $entry = $archive.CreateEntry('manifest.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try {
        $writer.Write((@{ targetFramework = 'net6.0'; purpose = 'Compile plugin and checks; not a game/runtime installation'; files = @($manifestFiles) } | ConvertTo-Json -Depth 5))
    } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force
Write-Output "Exported $($relativeFiles.Count) reference DLLs: $archivePath"
