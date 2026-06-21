param([switch]$DryRun)

$dir = "c:\Users\Lenovo\Downloads\deplao-builder-main (1)\deplao-builder-main\frontend\deplao-ui"
$exts = @('.tsx', '.ts', '.css', '.js', '.json', '.md')

$utf8    = [System.Text.Encoding]::UTF8
$latin1  = [System.Text.Encoding]::GetEncoding("iso-8859-1")
$noBomWriter = New-Object System.Text.UTF8Encoding($false)  # UTF-8 without BOM

$fixed   = [System.Collections.Generic.List[string]]::new()
$skipped = 0
$errors  = [System.Collections.Generic.List[string]]::new()

Get-ChildItem -Path $dir -Recurse -File | Where-Object {
    $exts -contains $_.Extension.ToLower() -and $_.FullName -notmatch 'node_modules'
} | ForEach-Object {
    $f = $_
    try {
        $bytes = [System.IO.File]::ReadAllBytes($f.FullName)

        # Strip UTF-8 BOM (EF BB BF)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            $bytes = $bytes[3..($bytes.Length - 1)]
        }

        # Decode as UTF-8
        $text = $utf8.GetString($bytes)

        # Quick check: if all ASCII, skip
        $hasNonAscii = $false
        foreach ($c in $text.ToCharArray()) {
            if ([int]$c -gt 127) { $hasNonAscii = $true; break }
        }
        if (-not $hasNonAscii) { $skipped++; return }

        # Try: encode as Latin-1, then decode as UTF-8
        $fixed_text = $null
        try {
            $rebytes = $latin1.GetBytes($text)
            $candidate = $utf8.GetString($rebytes)
            if ($candidate -ne $text) {
                $fixed_text = $candidate
            }
        } catch { }

        if ($null -eq $fixed_text) { $skipped++; return }

        if (-not $DryRun) {
            [System.IO.File]::WriteAllBytes($f.FullName, $noBomWriter.GetBytes($fixed_text))
        }
        $fixed.Add($f.Name)

    } catch {
        $errors.Add("[ERROR] $($f.Name): $_")
    }
}

Write-Host "=== Encoding Fix $(if ($DryRun) {'(DRY RUN)'} else {'(APPLIED)'}) ===" -ForegroundColor Cyan
Write-Host "Fixed $($fixed.Count) files:" -ForegroundColor Green
$fixed | ForEach-Object { Write-Host "  + $_" }
Write-Host "Skipped $skipped files (no change needed)"
if ($errors.Count -gt 0) {
    Write-Host "Errors:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $_" }
}
