param([Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $repoRoot 'store/exports/manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.validationScope -ne 'complete-four-master-marketing-set') {
  throw 'Run complete marketing validation before packaging.'
}
$appVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'app.json') -Raw | ConvertFrom-Json).expo.version
if ($appVersion -ne $Version) { throw "Package version $Version differs from app $appVersion." }
$media = @($manifest.sourceImages) + @($manifest.pngs) + @($manifest.videos)
$metadata = @(
  'store/exports/manifest.json',
  'store/exports/changed-surfaces.render.json',
  'store/source-captures/iphone-420x911/08-status-avatar.capture.json',
  'store/source-captures/iphone-420x911/25-menu.capture.json',
  'store/exports/video/interactive-guide/en-US/habhub-full-interactive-guide.capture.json',
  'store/README.md',
  'store/capture-plan.json',
  'store/video/storyboard.md',
  'store/video/capture-runbook.md',
  "docs/AVATAR_RESTORATION_$Version.md"
)
$files = @($media | ForEach-Object { $_.path }) + $metadata
if (($files | Select-Object -Unique).Count -ne $files.Count) { throw 'Duplicate package paths.' }
$expectedHashes = @{}
foreach ($item in $media) { $expectedHashes[$item.path] = $item.sha256 }
foreach ($relative in $files) {
  $resolved = [IO.Path]::GetFullPath((Join-Path $repoRoot $relative))
  if (-not $resolved.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Package path escaped the workspace: $relative"
  }
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Missing package file: $relative" }
  $actualHash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expectedHashes.ContainsKey($relative) -and $expectedHashes[$relative] -ne $actualHash) {
    throw "Media no longer matches the validated manifest: $relative"
  }
  $expectedHashes[$relative] = $actualHash
}
$archivePath = Join-Path $repoRoot "store/exports/habhub-$Version-marketing.zip"
if (Test-Path -LiteralPath $archivePath) { throw "Preserving existing archive; choose a new version: $archivePath" }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, (Join-Path $repoRoot $relative), $relative,
      [IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally { $archive.Dispose(); $stream.Dispose() }

$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if ($archive.Entries.Count -ne $files.Count) { throw 'Archive entry count mismatch.' }
  foreach ($entry in $archive.Entries) {
    if (-not $expectedHashes.ContainsKey($entry.FullName)) { throw "Unexpected archive entry: $($entry.FullName)" }
    $entryStream = $entry.Open()
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
      $actualHash = [BitConverter]::ToString($algorithm.ComputeHash($entryStream)).Replace('-', '').ToLowerInvariant()
      if ($actualHash -ne $expectedHashes[$entry.FullName]) { throw "Archive hash mismatch: $($entry.FullName)" }
    } finally { $algorithm.Dispose(); $entryStream.Dispose() }
  }
} finally { $archive.Dispose() }
[PSCustomObject]@{
  archive = $archivePath
  files = $files.Count
  verifiedMedia = $media.Count
  bytes = (Get-Item -LiteralPath $archivePath).Length
  sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json
