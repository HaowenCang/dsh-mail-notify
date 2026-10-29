[CmdletBinding()]
param([switch]$ValidateOnly)

$ErrorActionPreference = 'Stop'
$releaseMetadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-manifest.json') -Raw | ConvertFrom-Json
if ($releaseMetadata.package -ne 'dsh-mail-notify' -or $releaseMetadata.version -ne '0.5.3') {
    throw 'Unexpected release manifest identity.'
}
if ($releaseMetadata.registry -ne 'https://registry.npmjs.org/' -or $releaseMetadata.distTag -ne 'latest') {
    throw 'Unexpected registry or dist-tag.'
}

$archiveCandidate = Join-Path $PSScriptRoot $releaseMetadata.archive.file
if (-not (Test-Path -LiteralPath $archiveCandidate -PathType Leaf)) {
    $archiveCandidate = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) $releaseMetadata.archive.file
}
$archivePath = (Resolve-Path -LiteralPath $archiveCandidate).Path
$archiveInfo = Get-Item -LiteralPath $archivePath
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($archiveInfo.Length -ne $releaseMetadata.archive.bytes -or $archiveHash -ne $releaseMetadata.archive.sha256) {
    throw 'Archive size or SHA-256 does not match the prepared release. Do not publish.'
}
$archivePackageText = & tar -xOf $archivePath 'package/package.json'
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the package identity from the archive.' }
$archivePackage = ($archivePackageText -join "`n") | ConvertFrom-Json
if ($archivePackage.name -ne $releaseMetadata.package -or $archivePackage.version -ne $releaseMetadata.version) {
    throw 'Archive package name/version does not match the release.'
}

Write-Host "Verified $($archivePackage.name)@$($archivePackage.version)"
Write-Host "Archive: $archivePath"
Write-Host "SHA-256: $archiveHash"
if ($ValidateOnly) {
    Write-Host 'Validation only. No npm publication command was executed.'
    return
}

# Run locally in an interactive terminal. npm handles login and 2FA itself.
# No OTP or token is read, stored, forwarded, or supplied by this script.
& npm publish $archivePath --access public --tag latest --registry 'https://registry.npmjs.org/' --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw "npm publish exited with code $LASTEXITCODE" }
