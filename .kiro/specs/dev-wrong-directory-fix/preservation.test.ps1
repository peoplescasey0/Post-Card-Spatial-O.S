<#
.SYNOPSIS
  Preservation Property Tests - Property 2: Existing Delegation Behavior Unchanged
  Dev Wrong Directory Fix (dev-wrong-directory-fix)

.DESCRIPTION
  Observation-first preservation tests run on UNFIXED code and are EXPECTED TO
  PASS. They capture the existing delegation behavior that must NOT change after
  the fix (a purely additive new parent delegator at G:\micro-host\package.json)
  is implemented in Task 3.

  Bug condition (isBugCondition) returns FALSE for every input exercised here,
  so these cases are outside the bug's scope and must behave exactly as they do
  today (design.md, Preservation Requirements).

  The "property" is stated over the directory domain: for each distinct
  (command, cwd) tuple, the observed behavior matches the expected pattern
  captured during observation. The cases are enumerated and iterated so every
  representative tuple in the domain is exercised (the "many test cases" for
  this deterministic config-file bug).

  Validates: Requirements 3.1, 3.2, 3.3, 3.4

  NOTE: This script only ever runs `npm run` (no script arg), which merely LISTS
  available scripts and exits immediately. It never starts the Vite dev server
  or any long-running process.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$results = [System.Collections.Generic.List[pscustomobject]]::new()
$overallPass = $true

function Write-Section($title) {
    Write-Host ''
    Write-Host ('=' * 70) -ForegroundColor DarkGray
    Write-Host $title -ForegroundColor Cyan
    Write-Host ('=' * 70) -ForegroundColor DarkGray
}

function Invoke-NpmRun($cwd) {
    # Run `npm run` (no script arg) from $cwd, capturing stdout+stderr to temp
    # files. This only lists scripts - it never boots a server.
    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        $proc = Start-Process -FilePath 'cmd.exe' `
            -ArgumentList '/c', 'npm', 'run' `
            -WorkingDirectory $cwd `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $outFile `
            -RedirectStandardError $errFile
        $stdout = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
        $stderr = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
        return [pscustomobject]@{
            ExitCode = $proc.ExitCode
            Output   = ($stdout + "`n" + $stderr)
        }
    } finally {
        Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Expected baseline (recorded on UNFIXED code during Task 2 observation).
# These SHA256 values are the byte-for-byte pre-fix baseline. The test asserts
# the live files still match. After the additive fix these files are untouched,
# so the same assertions pass in Task 3.3 (Requirement 3.3).
# ---------------------------------------------------------------------------
$expectedHashes = [ordered]@{
    'g:\micro-host\micro-host\package.json'                         = '40F07C2B91A9568780FE3ACC1D8CF6653FCE7E59537CD48CA7AF51B7AE11A614'
    'g:\micro-host\micro-host\workspace-prototype\package.json'      = '1180D3827C6D3C5CD9ED3ED1B758D3CAAF5A3756C8D89E860B4DB7768C5144B7'
}

# ---------------------------------------------------------------------------
# Phase 0: Preservation baseline - existing package.json files unchanged
#   Requirement 3.3: existing files are byte-for-byte unchanged by the fix.
#   Compute SHA256 of each, assert it equals the recorded baseline, and write
#   the baseline JSON so Task 3.3 can read and compare.
# ---------------------------------------------------------------------------
Write-Section 'Phase 0: Preservation Baseline (existing files unchanged - Req 3.3)'

$baselinePath = Join-Path $PSScriptRoot 'preservation-baseline.json'
$baselineFiles = [ordered]@{}

foreach ($file in $expectedHashes.Keys) {
    if (-not (Test-Path $file)) {
        Write-Host "[FAIL] $file does not exist - cannot record baseline" -ForegroundColor Red
        $results.Add([pscustomobject]@{ Phase='Baseline'; Case=$file; Asserted='file exists & sha256 matches baseline'; Observed='file missing'; Passed=$false; Requirement='3.3' })
        $overallPass = $false
        continue
    }
    $hash = (Get-FileHash -Algorithm SHA256 -Path $file).Hash
    $bytes = (Get-Item $file).Length
    $baselineFiles[$file] = [ordered]@{ sha256 = $hash; bytes = $bytes }

    $match = ($hash -eq $expectedHashes[$file])
    if ($match) {
        Write-Host "[PASS] $file SHA256 matches baseline ($hash)" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $file SHA256 mismatch: expected $($expectedHashes[$file]), got $hash" -ForegroundColor Red
        $overallPass = $false
    }
    $results.Add([pscustomobject]@{
        Phase='Baseline'; Case=$file
        Asserted="sha256 == $($expectedHashes[$file])"
        Observed="sha256 = $hash; bytes = $bytes"
        Passed=$match; Requirement='3.3'
    })
}

# Write/refresh the durable baseline JSON so Task 3.3 can read and compare.
$baselineObject = [ordered]@{
    description   = 'Pre-fix preservation baseline for dev-wrong-directory-fix. Recorded on UNFIXED code during Task 2 (observation-first methodology). Task 3.3 recomputes these checksums post-fix and compares them to confirm the existing package.json files are byte-for-byte unchanged (Requirement 3.3).'
    spec          = 'dev-wrong-directory-fix'
    recordedBy    = 'Task 2 - preservation property tests'
    files         = $baselineFiles
}
$baselineObject | ConvertTo-Json -Depth 6 | Set-Content -Path $baselinePath -Encoding UTF8
Write-Host "Baseline written to: $baselinePath" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# Phase 1: Property 2 over the directory domain - non-buggy (command, cwd) tuples
#   For each directory in the domain, run `npm run` (no arg) and assert the
#   observed listing pattern matches the baseline behavior.
#   Requirement 3.1 / 3.3: project root delegates to workspace-prototype.
#   Requirement 3.2: workspace-prototype lists Vite scripts directly.
# ---------------------------------------------------------------------------
Write-Section 'Phase 1: Property 2 - delegation listing behavior across the directory domain'

# Each case: a (command, cwd) tuple in the directory domain with its expected
# pattern. ExpectScripts = script names that must appear in the listing.
# ExpectContains = a substring proving the expected delegation/direct style.
$domainCases = @(
    [pscustomobject]@{
        Label          = 'Project root delegator'
        Cwd            = 'g:\micro-host\micro-host'
        ExpectExitZero= $true
        ExpectScripts  = @('dev','build','preview','test')
        ExpectContains = 'workspace-prototype'
        Requirement    = '3.1,3.3'
        Behavior       = 'npm finds the existing delegator and lists dev/build/preview/test, delegating via npm --prefix workspace-prototype'
    },
    [pscustomobject]@{
        Label          = 'Workspace-prototype direct'
        Cwd            = 'g:\micro-host\micro-host\workspace-prototype'
        ExpectExitZero= $true
        ExpectScripts  = @('dev','build','preview','test')
        ExpectContains = 'vite'
        Requirement    = '3.2'
        Behavior       = 'npm lists the Vite scripts directly with no delegator indirection'
    }
)

foreach ($case in $domainCases) {
    Write-Host ''
    Write-Host "Case: npm run (cwd = $($case.Cwd))" -ForegroundColor White
    $r = Invoke-NpmRun $case.Cwd
    $combined = $r.Output
    $exitOk = if ($case.ExpectExitZero) { $r.ExitCode -eq 0 } else { $r.ExitCode -ne 0 }

    $scriptsOk = $true
    $missing = @()
    foreach ($s in $case.ExpectScripts) {
        if ($combined -notmatch ('\b' + [regex]::Escape($s) + '\b')) { $scriptsOk = $false; $missing += $s }
    }
    $containsOk = if ($case.ExpectContains) { $combined -match [regex]::Escape($case.ExpectContains) } else { $true }

    $casePass = $exitOk -and $scriptsOk -and $containsOk
    if (-not $casePass) { $overallPass = $false }

    if ($casePass) {
        Write-Host "[PASS] exit=$($r.ExitCode); scripts present: $($case.ExpectScripts -join ', '); contains '$($case.ExpectContains)'" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] exit=$($r.ExitCode); exitOk=$exitOk; missingScripts=$($missing -join ','); containsOk=$containsOk" -ForegroundColor Red
        Write-Host "       Output:" -ForegroundColor DarkYellow
        Write-Host $combined -ForegroundColor DarkGray
    }

    $results.Add([pscustomobject]@{
        Phase      = 'Property2-Listing'
        Case       = $case.Label
        Cwd        = $case.Cwd
        Asserted   = $case.Behavior
        Observed   = "exit=$($r.ExitCode); scriptsPresent=$scriptsOk; contains='$($case.ExpectContains)'=$containsOk"
        Passed     = $casePass
        Requirement= $case.Requirement
    })
}

# ---------------------------------------------------------------------------
# Phase 2: Property 2 - arbitrary directory with no package.json & no delegator
#   Requirement 3.4: continues to fail with ENOENT, no new error-reporting system.
#   Uses a fresh temp dir under G:\ (clean ancestor chain - G:\ has no
#   package.json, and this dir is NOT G:\micro-host). Created, asserted, cleaned.
# ---------------------------------------------------------------------------
Write-Section 'Phase 2: Property 2 - no-package directory still fails with ENOENT (Req 3.4)'

# Pick a base whose entire ancestor chain has no package.json. G:\ is clean
# (confirmed during observation: G:\ has no package.json, and a temp dir under
# G:\ does not pass through G:\micro-host). Avoid the user profile dir because
# C:\Users\Casey contains a package.json that npm would walk up to.
$baseForTemp = 'G:\'
$chainClean = $true
$walker = $baseForTemp
while ($walker) {
    if (Test-Path (Join-Path $walker 'package.json')) { $chainClean = $false; break }
    $parent = Split-Path $walker -Parent
    if (-not $parent -or $parent -eq $walker) { break }
    $walker = $parent
}
if (-not $chainClean) {
    Write-Host "[FAIL] Base $baseForTemp has a package.json up its ancestor chain; cannot isolate temp dir" -ForegroundColor Red
    $results.Add([pscustomobject]@{ Phase='Property2-ENOENT'; Case='isolated no-package dir'; Asserted='ENOENT failure'; Observed='temp base not clean'; Passed=$false; Requirement='3.4' })
    $overallPass = $false
} else {
    $tmpDir = Join-Path $baseForTemp ('kiro-pres-' + [System.Guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    try {
        $pkgHere = Test-Path (Join-Path $tmpDir 'package.json')
        $r = Invoke-NpmRun $tmpDir
        $combined = $r.Output
        $isEnoent = ($combined -match 'ENOENT') -and ($combined -match [regex]::Escape($tmpDir))
        $casePass = ($pkgHere -eq $false) -and ($r.ExitCode -ne 0) -and $isEnoent
        if (-not $casePass) { $overallPass = $false }

        if ($casePass) {
            Write-Host "[PASS] fresh no-package dir failed with ENOENT (exit=$($r.ExitCode)); no new error-reporting system" -ForegroundColor Green
        } else {
            Write-Host "[FAIL] expected ENOENT but: pkgHere=$pkgHere; exit=$($r.ExitCode); enoent=$isEnoent" -ForegroundColor Red
            Write-Host "       Output:" -ForegroundColor DarkYellow
            Write-Host $combined -ForegroundColor DarkGray
        }
        $results.Add([pscustomobject]@{
            Phase      = 'Property2-ENOENT'
            Case       = 'isolated no-package dir'
            Cwd        = $tmpDir
            Asserted   = 'npm run fails with ENOENT, no new error-reporting system (Req 3.4)'
            Observed   = "exit=$($r.ExitCode); pkgHere=$pkgHere; enoent=$isEnoent"
            Passed     = $casePass
            Requirement= '3.4'
        })
    } finally {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
        Write-Host "Cleaned up temp dir: $tmpDir (exists: $(Test-Path $tmpDir))" -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Section 'Summary'
Write-Host ''
Write-Host 'Per-case results:' -ForegroundColor White
$results | Format-Table -AutoSize | Out-String | Write-Host

Write-Host ''
if ($overallPass) {
    Write-Host 'OVERALL: PASS - preservation baseline recorded; existing behavior unchanged (expected on unfixed code)' -ForegroundColor Green
} else {
    Write-Host 'OVERALL: FAIL - one or more preservation assertions failed (unexpected on unfixed code)' -ForegroundColor Red
}

if ($overallPass) { exit 0 } else { exit 1 }
