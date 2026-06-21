
<#
  Re-copy deplao-ui from src/ui with correct UTF-8 encoding.
  Applies @/ -> @deplao/ alias substitution.
  Skips web-only override files that must not be overwritten.
#>

$srcDir    = "c:\Users\Lenovo\Downloads\deplao-builder-main (1)\deplao-builder-main\src\ui"
$destDir   = "c:\Users\Lenovo\Downloads\deplao-builder-main (1)\deplao-builder-main\frontend\deplao-ui"

# Files in deplao-ui that are web-specific overrides — DO NOT overwrite
$skipRelPaths = @(
    "lib\ipc.ts",
    "lib\electronPolyfill.ts"
)

$noBom = New-Object System.Text.UTF8Encoding($false)
$utf8  = [System.Text.Encoding]::UTF8

$copied  = 0
$skipped = 0

Get-ChildItem -Path $srcDir -Recurse -File | ForEach-Object {
    $srcFile = $_
    $relPath = $srcFile.FullName.Substring($srcDir.Length).TrimStart('\')

    # Skip web-only overrides
    $relPathNorm = $relPath.Replace('/', '\')
    if ($skipRelPaths -contains $relPathNorm) {
        Write-Host "  SKIP (override) $relPath"
        $skipped++
        return
    }

    $destFile = Join-Path $destDir $relPath

    # Ensure destination directory exists
    $destDir2 = Split-Path $destFile -Parent
    if (-not (Test-Path $destDir2)) {
        New-Item -ItemType Directory -Force -Path $destDir2 | Out-Null
    }

    # Read source bytes, strip BOM
    $bytes = [System.IO.File]::ReadAllBytes($srcFile.FullName)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $bytes = $bytes[3..($bytes.Length - 1)]
    }

    $ext = $srcFile.Extension.ToLower()
    if ($ext -in @('.tsx', '.ts', '.js', '.css', '.json', '.md')) {
        # Text file: decode, replace alias, re-encode without BOM
        $text = $utf8.GetString($bytes)

        # Replace @/ alias with @deplao/ for TypeScript imports
        $text = $text -replace "from '@/", "from '@deplao/"
        $text = $text -replace 'from "@/', 'from "@deplao/'
        $text = $text -replace "import '@/", "import '@deplao/"
        $text = $text -replace 'import "@/', 'import "@deplao/'

        # For index.css: add @charset and @reference at top if not present
        if ($relPath -eq 'index.css' -or $relPath -eq 'index.css') {
            if (-not $text.StartsWith('@charset')) {
                $text = "@charset `"UTF-8`";`n/* Required by Tailwind v4: makes utilities available to @apply in this file */`n@reference `"tailwindcss`";`n`n" + $text
            }
        }

        [System.IO.File]::WriteAllBytes($destFile, $noBom.GetBytes($text))
    } else {
        # Binary file: copy as-is
        [System.IO.File]::WriteAllBytes($destFile, $bytes)
    }

    $copied++
}

Write-Host "`n=== Re-copy complete ===" -ForegroundColor Cyan
Write-Host "Copied : $copied files" -ForegroundColor Green
Write-Host "Skipped: $skipped files (web overrides preserved)"
