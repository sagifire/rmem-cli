param(
    [string]$Node = "node",
    [string]$CliPath = ".\packages\rmem-cli\dist\main.js"
)

$ErrorActionPreference = "Stop"

$resolvedCliPath = (Resolve-Path -LiteralPath $CliPath).Path
$root = Join-Path $env:TEMP ("rmem-real-model-smoke-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $root | Out-Null

try {
    Push-Location $root

    $documentBytes = [System.Convert]::FromBase64String("IyBSZWFsIE1vZGVsIFNtb2tlCgrQlNC+0LrRg9C80LXQvdGC0Lgg0LrQtdGA0YPRjtGC0Ywg0LfQvdCw0L3QvdGP0LzQuCwg0LAgQkdFLU0zINCx0YPQtNGD0ZQgc2VtYW50aWMgcmV0cmlldmFsIHZlY3RvcnMuCk9sbGFtYSDQstC40LrQvtGA0LjRgdGC0L7QstGD0ZTRgtGM0YHRjyDRj9C6INC70L7QutCw0LvRjNC90LjQuSBzZW1hbnRpYyBjb21waWxlciDQtNC70Y8gZGVyaXZlZCBub3Rlcy4=")
    [System.IO.File]::WriteAllBytes((Join-Path (Get-Location) "doc.md"), $documentBytes)

    & $Node $resolvedCliPath write smoke.md --from doc.md
    if ($LASTEXITCODE -ne 0) {
        throw "rmem write failed"
    }

    & $Node $resolvedCliPath dev providers check
    if ($LASTEXITCODE -ne 0) {
        throw "rmem dev providers check failed"
    }

    & $Node $resolvedCliPath dev embeddings status
    if ($LASTEXITCODE -ne 0) {
        throw "rmem dev embeddings status failed"
    }

    & $Node $resolvedCliPath search "semantic retrieval vectors"
    if ($LASTEXITCODE -ne 0) {
        throw "rmem search failed"
    }

    & $Node $resolvedCliPath check
    if ($LASTEXITCODE -ne 0) {
        throw "rmem check failed"
    }
} finally {
    Pop-Location
    Remove-Item -Recurse -Force -LiteralPath $root
}
