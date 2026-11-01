<#
.SYNOPSIS
  Bug Condition Exploration Test - Property 1: Bug Condition
  Dev Wrong Directory Fix (dev-wrong-directory-fix)

.DESCRIPTION
  This is a bug-condition exploration test for a bugfix spec. It runs on
  UNFIXED code and is EXPECTED TO FAIL. The failure is the SUCCESS case for
  an exploration test because it surfaces a counterexample that proves the
  bug exists.

  Bug condition (from design.md isBugCondition):
    input.command IN ["npm run dev", "npm run build", "npm run preview", "npm run test"]
    AND input.cwd == "G:\micro-host"
    AND NOT packageJsonExists(input.cwd)
    AND commandFailsWithENOENT(input.command, input.cwd)

  This script encodes Property 1 (the expected FIXED behavior): that each of
  the four npm scripts, invoked with cwd G:\micro-host, SHALL succeed by
  delegating down through micro-host to workspace-prototype. On unfixed code
  these assertions FAIL because npm aborts with ENOENT before anything starts.
  The captured ENOENT errors are the counterexamples proving the missing
  parent delegator (G:\micro-host\package.json) is the root cause.

  Validates: Requirements 1.1, 1.2 (current/defect behavior)
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$parentDir = 'G:\micro-host'
$results = [System.Collections.Generic.List[pscustomobject]]::new()
$counterexamples = [System.Collections.Generic.List[string]]::new()
$overallPass = $true

function Write-Section($title) {
    Write-Host ''
    Write-Host ('=' * 70) -ForegroundColor DarkGray
    Write-Host $title -ForegroundColor Cyan
    Write-Host ('=' * 70) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Phase 0: Root cause confirmation - no package.json exists at G:\micro-host
# ---------------------------------------------------------------------------
Write-Section 'Phase 0: Root Cause Confirmation (absent package.json)'
$rootCausePass = -not (Test-Path (Join-Path $parentDir 'package.json'))
if ($rootCausePass) {
    Write-Host "[PASS] Test-Path G:\micro-host\package.json returned False - root cause confirmed (no delegator at parent)" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Test-Path G:\micro-host\package.json returned True - a package.json already exists; root cause may already be fixed" -ForegroundColor Yellow
    $overallPass = $false
}
$results.Add([pscustomobject]@{
    Phase       = 'RootCause'
    Case        = 'no-package.json-at-parent'
    Asserted    = 'Test-Path returns False'
    Observed    = "Test-Path returned $(Test-Path (Join-Path $parentDir 'package.json'))"
    Passed      = $rootCausePass
    Counterexample = if ($rootCausePass) { 'none - file absent as expected' } else { 'package.json unexpectedly present' }
})

# ---------------------------------------------------------------------------
# Phase 1: Property 1 - Parent Directory Delegation Succeeds (expected fixed behavior)
#   For each npm script, invoke from G:\micro-host and assert it SUCCEEDS.
#   On unfixed code this FAILS with ENOENT - the counterexample proving the bug.
# ---------------------------------------------------------------------------
Write-Section 'Phase 1: Property 1 - Expected Behavior (scripts SHALL succeed from parent)'

$scripts = @('dev', 'build', 'preview', 'test')
foreach ($script in $scripts) {
    Write-Host ''
    Write-Host "Case: npm run $script (cwd = $parentDir)" -ForegroundColor White

    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        # Invoke npm from the parent directory via cmd.exe so PATH/PATHEXT
        # resolve npm -> npm.cmd reliably. npm run dev fails with ENOENT
        # immediately (it never starts Vite), so this is safe and non-blocking.
        $proc = Start-Process -FilePath 'cmd.exe' `
            -ArgumentList "/c npm run $script" `
            -WorkingDirectory $parentDir `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $outFile `
            -RedirectStandardError $errFile
        $exitCode = $proc.ExitCode
        $stdout = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
        $stderr = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
    } finally {
        Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
    }

    $combined = ($stdout + "`n" + $stderr).Trim()
    $isEnoent = ($combined -match 'ENOENT') -and ($combined -match [regex]::Escape($parentDir))
    $succeeded = ($exitCode -eq 0)

    # Property 1 asserts the FIXED behavior: the script SHALL succeed.
    $casePass = $succeeded
    if (-not $casePass) { $overallPass = $false }

    $cex = 'none'
    if ($isEnoent) {
        # Extract the ENOENT line(s) for the counterexample record
        $enoentLines = ($combined -split "`r?`n" | Where-Object { $_ -match 'ENOENT' -or $_ -match 'no such file or directory' -or $_ -match [regex]::Escape($parentDir) })
        $cex = ($enoentLines -join ' | ')
        $counterexamples.Add("[$script] exitCode=$exitCode; $cex")
    } elseif (-not $succeeded) {
        $cex = "exitCode=$exitCode; $combined"
        $counterexamples.Add("[$script] $cex")
    }

    if ($casePass) {
        Write-Host "[PASS] npm run $script succeeded (exit 0) - unexpected on unfixed code" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] npm run $script did NOT succeed (exit $exitCode) - counterexample captured" -ForegroundColor Red
        Write-Host "       ENOENT detected: $isEnoent" -ForegroundColor DarkYellow
        Write-Host "       Counterexample: $cex" -ForegroundColor DarkYellow
    }

    $results.Add([pscustomobject]@{
        Phase         = 'Property1'
        Case          = "npm run $script"
        Asserted      = 'script succeeds (exit 0) by delegating to micro-host -> workspace-prototype'
        Observed      = "exitCode=$exitCode; ENOENT=$isEnoent"
        Passed        = $casePass
        Counterexample = $cex
    })
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Section 'Summary'
Write-Host ''
Write-Host 'Per-case results:' -ForegroundColor White
$results | Format-Table -AutoSize | Out-String | Write-Host

Write-Host 'Counterexamples (proving the bug exists):' -ForegroundColor White
if ($counterexamples.Count -eq 0) {
    Write-Host '  (none captured - no failures observed)' -ForegroundColor Green
} else {
    foreach ($c in $counterexamples) {
        Write-Host "  - $c" -ForegroundColor Yellow
    }
}

Write-Host ''
if ($overallPass) {
    Write-Host 'OVERALL: PASS - exploration test passed; bug NOT reproduced (unexpected on unfixed code)' -ForegroundColor Green
} else {
    Write-Host 'OVERALL: FAIL - exploration test failed as expected; bug reproduced via counterexamples above' -ForegroundColor Yellow
    Write-Host '        (For a bug-condition exploration test, this FAIL is the SUCCESS outcome: it proves the bug exists.)' -ForegroundColor DarkYellow
}

# Exit non-zero when the exploration test "fails" (bug reproduced), so CI/automation
# can detect the expected failure. Exit zero only if all Property 1 assertions passed.
if ($overallPass) { exit 0 } else { exit 1 }
