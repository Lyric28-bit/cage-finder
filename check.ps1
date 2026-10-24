# Pre-push guard for Cage Notes. Read-only: no fetch, no push, no file changes.
# Run: powershell -ExecutionPolicy Bypass -File check.ps1
# Prints PASS / WARN / FAIL lines, exits 1 if any FAIL, otherwise 0.

Set-Location -LiteralPath $PSScriptRoot
$script:failed = 0

function Pass($msg) { Write-Host "PASS  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "WARN  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "FAIL  $msg" -ForegroundColor Red; $script:failed++ }
function Note($msg) { Write-Host "NOTE  $msg" -ForegroundColor Gray }

# ---- 1. branch ----
$branch = (git branch --show-current | Out-String).Trim()
if ($branch -eq 'main') {
    Pass 'on branch main'
} elseif ($branch -eq 'backup-with-photos') {
    Fail 'on branch backup-with-photos: it holds the workplace photos. NEVER push it. Switch to main.'
} else {
    Fail "on branch '$branch', expected main"
}

# ---- 2. JSON files parse ----
$jsonFiles = @(Get-ChildItem -LiteralPath 'data' -Filter '*.json' -File | ForEach-Object { $_.FullName })
$jsonFiles += (Join-Path $PSScriptRoot 'manifest.webmanifest')
$badJson = @()
foreach ($f in $jsonFiles) {
    try {
        $null = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        $badJson += (Split-Path $f -Leaf) + ': ' + $_.Exception.Message
    }
}
if ($badJson.Count -eq 0) { Pass "$($jsonFiles.Count) JSON files parse (data/*.json + manifest.webmanifest)" }
else { foreach ($b in $badJson) { Fail "JSON does not parse: $b" } }

# ---- 3. no photos / private test files tracked or staged ----
$tracked = @(git ls-files)
$staged = @(git diff --cached --name-only)
$bad = @()
foreach ($p in ($tracked + $staged)) {
    if ($p -like 'sheets/*' -or $p -like 'test-data/*') { $bad += $p }
}
if ($tracked -contains 'tests-ui.html' -or $staged -contains 'tests-ui.html') { $bad += 'tests-ui.html' }
$bad = @($bad | Select-Object -Unique)
if ($bad.Count -eq 0) { Pass 'nothing under sheets/ or test-data/ tracked or staged; tests-ui.html not tracked' }
else { foreach ($b in $bad) { Fail "must not be tracked/staged: $b" } }

# ---- 4. VERSION bump vs origin/main ----
Note 'origin/main is as of the last fetch (this script does not fetch)'
$null = git rev-parse --verify --quiet origin/main
if ($LASTEXITCODE -ne 0) {
    Fail 'origin/main not found, cannot compare'
} else {
    $changed = @(git diff --name-only origin/main)
    $changed += @(git ls-files --others --exclude-standard)
    $changed = @($changed | Where-Object { $_ } | Select-Object -Unique)
    $ignore = @('CLAUDE.md', 'README.md', 'check.ps1', 'tests.html', '.gitignore')
    $appChanges = @($changed | Where-Object { $ignore -notcontains $_ })
    if ($appChanges.Count -eq 0) {
        Pass 'VERSION check: no app changes vs origin/main'
    } else {
        $rx = "const\s+VERSION\s*=\s*'([^']+)'"
        $localSw = Get-Content -LiteralPath 'sw.js' -Raw -Encoding UTF8
        $remoteSw = (git show origin/main:sw.js | Out-String)
        $lv = if ($localSw -match $rx) { $Matches[1] } else { $null }
        $rv = if ($remoteSw -match $rx) { $Matches[1] } else { $null }
        if (-not $lv -or -not $rv) {
            Fail "could not read VERSION from sw.js (local '$lv', origin/main '$rv')"
        } elseif ($lv -eq $rv) {
            Fail "app files changed ($($appChanges -join ', ')) but sw.js VERSION is still $lv"
        } else {
            Pass "sw.js VERSION bumped $rv -> $lv ($($appChanges.Count) app file(s) changed)"
        }
    }

    # ---- 5. sheetVersion when cage/suburb content changed ----
    try {
        $localCages = Get-Content -LiteralPath 'data/cages.json' -Raw -Encoding UTF8 | ConvertFrom-Json
        $remoteCages = (git show origin/main:data/cages.json | Out-String) | ConvertFrom-Json
        $shape = { param($d) ConvertTo-Json -Depth 6 -Compress @($d.cages | ForEach-Object { [pscustomobject]@{ n = $_.name; s = @($_.suburbs) } }) }
        $same = (& $shape $localCages) -eq (& $shape $remoteCages)
        if ($same) {
            Pass 'sheetVersion check: cage/suburb content unchanged vs origin/main'
        } elseif ($localCages.sheetVersion -ne $remoteCages.sheetVersion) {
            Pass "cage/suburb content changed and sheetVersion bumped $($remoteCages.sheetVersion) -> $($localCages.sheetVersion)"
        } else {
            Warn "cage/suburb content in data/cages.json changed but sheetVersion is still $($localCages.sheetVersion). Bump it if the change should reach phones (renames shipped via CAGE_RENAMES do not need it)."
        }
    } catch {
        Fail "could not compare data/cages.json with origin/main: $($_.Exception.Message)"
    }
}

Write-Host ''
if ($script:failed -gt 0) { Write-Host "$($script:failed) check(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host 'All checks passed' -ForegroundColor Green
exit 0
