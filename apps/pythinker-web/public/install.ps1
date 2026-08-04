# Pythinker Code — native Windows installer bootstrap.
#
# Downloads the latest PythinkerSetup-x.y.z.exe from GitHub Releases, verifies
# its SHA-256 file, and runs the per-user Inno Setup installer silently.
#
# Usage:
#   irm https://pythinker.com/install.ps1 | iex
#
# To pin a version when running the hosted script, set:
#   $env:PYTHINKER_VERSION = "0.27.0"; irm https://pythinker.com/install.ps1 | iex
#
# Or run the script directly:
#   .\install.ps1 -Version 0.27.0

[CmdletBinding()]
param(
  [string]$Version = $env:PYTHINKER_VERSION,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

$Repo = "Pythoughts-labs/pythinker-code"
$InstallShUrl = "https://pythinker.com/install.sh"
$InstallPs1Url = "https://pythinker.com/install.ps1"
$NoColor = $env:NO_COLOR

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$ESC = [char]27
$useAnim = -not $env:PYTHINKER_NO_ANIMATION `
  -and -not $env:CI `
  -and -not $NoColor `
  -and $Host.UI.RawUI -ne $null `
  -and -not [Console]::IsOutputRedirected

if ($useAnim) {
  $NAVY  = "$ESC[38;5;24m"
  $FACE  = "$ESC[38;5;255m"
  $ACCENT = "$ESC[38;5;147m"
  $TIP   = "$ESC[38;5;216m"
  $EYE   = "$ESC[38;5;189m"
  $BAR   = "$ESC[38;5;250m"
  $DIM   = "$ESC[2m"
  $BOLD  = "$ESC[1m"
  $RESET = "$ESC[0m"
  $SHINE = "$ESC[38;5;231m"
  $SOFT  = "$ESC[38;5;111m"
  $HIDE  = "$ESC[?25l"
  $SHOW  = "$ESC[?25h"
} else {
  $NAVY = $FACE = $ACCENT = $TIP = $EYE = $BAR = $DIM = $BOLD = $RESET = $SHINE = $SOFT = $HIDE = $SHOW = ""
}

$script:GridOriginRow = 5
$script:AntennaTipCol = 7
$script:ProgressRow = 17
$script:AntennaSpinActive = $false

function Show-Usage {
  @"
Pythinker Code — native Windows installer bootstrap.

Downloads the latest PythinkerSetup-x.y.z.exe from GitHub Releases, verifies
its SHA-256 file, and runs the per-user Inno Setup installer silently.

Usage:
  irm $InstallPs1Url | iex

  # Pin a version:
  `$env:PYTHINKER_VERSION = "0.27.0"; irm $InstallPs1Url | iex

  # Or run directly:
  .\install.ps1 -Version 0.27.0

Unix / macOS / Linux users:
  curl -fsSL $InstallShUrl | bash
"@
}

function Fail($msg) {
  Write-Host "  ${TIP}✗${RESET} $msg" -ForegroundColor Red
  exit 1
}

function Phase-Ok($label) {
  if ($useAnim) {
    Write-Host -NoNewline "$HIDE"
    try {
      for ($i = 1; $i -le 3; $i++) {
        $dots = "." * $i
        Write-Host ("`r  {0,-11} {1}OK{2}{3}" -f $label, $ACCENT, $dots, $RESET) -NoNewline
        Start-Sleep -Milliseconds 60
      }
      Write-Host ("`r  {0,-11} {1}OK {2}✓{3}" -f $label, $ACCENT, $SHINE, $RESET)
    } finally {
      Write-Host -NoNewline "$SHOW"
    }
  } else {
    Write-Host ("  {0,-11} {1}OK {2}✓{3}" -f $label, $ACCENT, $SHINE, $RESET)
  }
}

function Write-Tagline {
  $tagline = "Pythinker Code  Think first. Then code."
  Write-Host -NoNewline "  "
  foreach ($ch in $tagline.ToCharArray()) {
    Write-Host -NoNewline $ch
    if ($useAnim) { Start-Sleep -Milliseconds 18 }
  }
  Write-Host "`n"
}

function Write-LogoArt {
  Write-Host "      ${TIP}●${RESET}"
  Write-Host "      ${NAVY}│${RESET}"
  Write-Host "  ${NAVY}▛${RESET}${FACE}▀▀▀▀▀▀▀${RESET}${NAVY}▜${RESET}"
  Write-Host " ${TIP}◖${RESET}${NAVY}█${RESET} ${EYE}◉${RESET}   ${EYE}◉${RESET} ${NAVY}█${RESET}${TIP}◗${RESET}"
  Write-Host "  ${NAVY}▙▄▄▄${RESET}${FACE}≡${RESET}${NAVY}▄▄▄▟${RESET}"
}

function Write-LogoStatic {
  Write-Host "`n`n`n`n"
  Write-LogoArt
  Write-Host ""
  Write-Tagline
}

function Set-AntennaTip($glyph) {
  if (-not $useAnim) { return }
  $row = $script:GridOriginRow - 1
  Write-Host -NoNewline ("${ESC}[${row};${script:AntennaTipCol}H${TIP}${glyph}${RESET}")
}

function Start-AntennaSpin { $script:AntennaSpinActive = $true }
function Stop-AntennaSpin {
  if (-not $script:AntennaSpinActive) { return }
  $script:AntennaSpinActive = $false
  Set-AntennaTip "●"
}

function Write-LogoAnimated {
  $rows = 5; $cols = 13
  $frameMs = 60; $staggerMs = 40
  if ($env:PYTHINKER_LOGO_FRAME_DELAY)   { try { $frameMs   = [int]([double]$env:PYTHINKER_LOGO_FRAME_DELAY   * 1000) } catch {} }
  if ($env:PYTHINKER_LOGO_STAGGER_DELAY) { try { $staggerMs = [int]([double]$env:PYTHINKER_LOGO_STAGGER_DELAY * 1000) } catch {} }

  $chars  = New-Object 'string[]' ($rows * $cols)
  $colors = New-Object 'string[]' ($rows * $cols)
  for ($i = 0; $i -lt $chars.Length; $i++) { $chars[$i] = ' '; $colors[$i] = '' }

  function Render-Grid($pieceR, $pieceC, [string[]]$cells) {
    $tc = $chars.Clone()
    $tk = $colors.Clone()
    if ($null -ne $pieceR) {
      foreach ($cell in $cells) {
        $parts = $cell -split ',', 4
        $rr = $pieceR + [int]$parts[0]
        $cc = $pieceC + [int]$parts[1]
        if ($rr -ge 0 -and $rr -lt $rows -and $cc -ge 0 -and $cc -lt $cols) {
          $idx = $rr * $cols + $cc
          $tc[$idx] = $parts[2]
          $tk[$idx] = $parts[3]
        }
      }
    }
    for ($r = 0; $r -lt $rows; $r++) {
      $line = New-Object System.Text.StringBuilder
      for ($c = 0; $c -lt $cols; $c++) {
        $idx = $r * $cols + $c
        if ($tk[$idx]) { [void]$line.Append("$($tk[$idx])$($tc[$idx])$RESET") }
        else { [void]$line.Append($tc[$idx]) }
      }
      Write-Host -NoNewline ("${ESC}[$($script:GridOriginRow + $r);1H$line${ESC}[K")
    }
  }

  function Drop-Piece($targetR, $targetC, [string[]]$cells) {
    for ($r = -1; $r -le $targetR; $r++) {
      Render-Grid $r $targetC $cells
      Start-Sleep -Milliseconds $frameMs
    }
    foreach ($cell in $cells) {
      $parts = $cell -split ',', 4
      $idx = ($targetR + [int]$parts[0]) * $cols + ($targetC + [int]$parts[1])
      $chars[$idx] = $parts[2]
      $colors[$idx] = $parts[3]
    }
    $shine = @()
    foreach ($cell in $cells) {
      $parts = $cell -split ',', 4
      $shine += ("$($parts[0]),$($parts[1]),$($parts[2]),$SHINE")
    }
    Render-Grid $targetR $targetC $shine
    Start-Sleep -Milliseconds 50
    Render-Grid $null $null @()
    if ($staggerMs -gt 0) { Start-Sleep -Milliseconds $staggerMs }
  }

  function Blink-Eye($targetR, $targetC, $eyeCh) {
    Render-Grid $targetR ($targetC - 1) @("0,0,$eyeCh,$SHINE")
    Start-Sleep -Milliseconds 60
    Render-Grid $targetR $targetC @("0,0,─,$EYE")
    Start-Sleep -Milliseconds 50
    $idx = $targetR * $cols + $targetC
    $chars[$idx] = '─'; $colors[$idx] = $EYE
    Render-Grid $null $null @()
    Start-Sleep -Milliseconds 40
    $chars[$idx] = $eyeCh; $colors[$idx] = $SHINE
    Render-Grid $null $null @()
    Start-Sleep -Milliseconds 60
    $chars[$idx] = $eyeCh; $colors[$idx] = $EYE
    Render-Grid $null $null @()
  }

  function Drop-AntennaTip($targetR, $targetC) {
    $cells = @("0,0,●,$TIP")
    for ($r = -1; $r -le $targetR; $r++) {
      Render-Grid $r $targetC $cells
      Start-Sleep -Milliseconds $frameMs
    }
    $idx = $targetR * $cols + $targetC
    $chars[$idx] = '●'; $colors[$idx] = $TIP
    Render-Grid $targetR $targetC @("0,0,●,$SHINE")
    Start-Sleep -Milliseconds 70
    $chars[$idx] = '●'; $colors[$idx] = $SHINE
    Render-Grid $null $null @()
    Start-Sleep -Milliseconds 50
    $chars[$idx] = '●'; $colors[$idx] = $TIP
    Render-Grid $null $null @()
  }

  Write-Host -NoNewline $HIDE
  try {
    Write-Host "`n`n`n`n"
    Drop-Piece 2 2  @("0,0,▛,$NAVY", "1,0,█,$NAVY", "2,0,▙,$NAVY")
    Drop-Piece 2 10 @("0,0,▜,$NAVY", "1,0,█,$NAVY", "2,0,▟,$NAVY")
    Drop-Piece 2 3  @("0,0,▀,$FACE", "0,1,▀,$FACE", "0,2,▀,$FACE", "0,3,▀,$FACE", "0,4,▀,$FACE", "0,5,▀,$FACE", "0,6,▀,$FACE")
    Drop-Piece 4 3  @("0,0,▄,$NAVY", "0,1,▄,$NAVY", "0,2,▄,$NAVY", "0,3,≡,$FACE", "0,4,▄,$NAVY", "0,5,▄,$NAVY", "0,6,▄,$NAVY")
    Blink-Eye 3 4 "◉"
    Blink-Eye 3 8 "◉"
    Drop-Piece 3 1  @("0,0,◖,$TIP")
    Drop-Piece 3 11 @("0,0,◗,$TIP")
    Drop-Piece 1 6  @("0,0,│,$NAVY")
    Drop-AntennaTip 0 6
    Write-Host -NoNewline ("${ESC}[$($script:GridOriginRow);1H")
    Write-LogoArt
    Write-Host ""
    Write-Tagline
  } finally {
    Write-Host -NoNewline $SHOW
  }
}

function Write-Logo {
  if ($useAnim) { Write-LogoAnimated } else { Write-LogoStatic }
}

function Print-Intro($version, $asset) {
  Write-Logo
  Write-Host ("  {0,-11} {1}" -f "Version", $version)
  Write-Host ("  {0,-11} {1}" -f "Platform", "Windows x64")
  Write-Host ("  {0,-11} {1}" -f "Package", $asset)
  Write-Host ""
}

function Write-DownloadProgress($percent, $frame, [switch]$Pulse) {
  $width = 48
  $filled = [Math]::Floor($percent * $width / 100)
  $empty = $width - $filled
  $bar = ("▰" * $filled) + ("▱" * $empty)
  if ($Pulse -and $filled -gt 0 -and $filled -lt $width) {
    $head = $filled - 1
    $rendered = "${BAR}$($bar.Substring(0, $head))${SHINE}▰${RESET}${BAR}$($bar.Substring($filled))${RESET}"
  } else {
    $rendered = "${BAR}${bar}${RESET}"
  }
  if ($useAnim) {
    Write-Host -NoNewline ("${ESC}[$($script:ProgressRow);1H${ESC}[K  ${ACCENT}${frame}${RESET} ${rendered} {0,3}%%" -f $percent)
  } else {
    Write-Host ("  ${ACCENT}${frame}${RESET} ${rendered} {0,3}%%" -f $percent)
  }
}

function Get-ContentLength($uri) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Method Head -Uri $uri
    $len = $resp.Headers['Content-Length']
    if ($len -match '^\d+$') { return [int64]$len }
  } catch {}
  return $null
}

function Download-WithProgress($uri, $path) {
  $total = Get-ContentLength $uri
  $frames = @('●', '◐', '◌', '◍', '◌', '◑', '◍', '⬤')
  $i = 0

  if ($useAnim) {
    Start-AntennaSpin
    Write-Host -NoNewline $HIDE
  }

  $job = Start-Job -ScriptBlock {
    param($u, $p)
    Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $p
  } -ArgumentList $uri, $path

  try {
    while ($job.State -eq 'Running') {
      $frame = $frames[$i % $frames.Length]
      $percent = 0
      if ($total -and (Test-Path $path)) {
        $size = (Get-Item $path).Length
        $percent = [Math]::Min(99, [Math]::Floor($size * 100 / $total))
      } elseif (-not $total) {
        $percent = ($i % 20) * 5
      }
      Set-AntennaTip $frame
      Write-DownloadProgress $percent $frame -Pulse:($i % 2 -eq 1)
      Start-Sleep -Milliseconds 100
      $i++
    }
    if ($job.State -eq 'Failed') {
      $err = ($job.ChildJobs | ForEach-Object { $_.JobStateInfo.Reason.Message }) -join '; '
      if ($err) { Fail "download failed: $uri ($err)" }
      else { Fail "download failed: $uri" }
    }
    Receive-Job $job -ErrorAction Stop | Out-Null
  } catch {
    Fail "download failed: $uri"
  } finally {
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if ($useAnim) {
      Stop-AntennaSpin
      Write-DownloadProgress 100 "✓"
      Write-Host ""
      Write-Host -NoNewline $SHOW
    } else {
      Write-DownloadProgress 100 "✓"
      Write-Host ""
    }
  }
}

function Print-Done {
  $sep = "──────────────────────────────────────────────────"
  if ($useAnim) {
    Write-Host -NoNewline $HIDE
    try {
      Write-Host "`n  ${DIM}${sep}${RESET}"
      Start-Sleep -Milliseconds 120
      Write-Host ("`r  ${BAR}${sep}${RESET}")
      Start-Sleep -Milliseconds 60
      Write-Host "  ${ACCENT}Ready. Start with:${RESET}`n"
      Write-Host -NoNewline "      ${DIM}pythinker${RESET}"
      Start-Sleep -Milliseconds 100
      Write-Host ("`r      ${BOLD}pythinker${RESET}`n")
    } finally {
      Write-Host -NoNewline $SHOW
    }
  } else {
    Write-Host "`n  ${BAR}${sep}${RESET}"
    Write-Host "  ${ACCENT}Ready. Start with:${RESET}`n"
    Write-Host "      ${BOLD}pythinker${RESET}`n"
  }
}

function Test-ReleaseHasInstaller($release) {
  if ($release.draft -or $release.prerelease) { return $null }
  $tag = [string]$release.tag_name
  if (-not $tag) { return $null }
  $candidate = $tag.TrimStart('v')
  $exe = "PythinkerSetup-$candidate.exe"
  $names = @($release.assets | ForEach-Object { [string]$_.name })
  if (($names -contains $exe) -and ($names -contains "$exe.sha256")) { return $candidate }
  return $null
}

function Format-ReleaseApiError($Uri, $ErrorRecord) {
  $message = $ErrorRecord.Exception.Message
  $status = $null
  try { $status = [int]$ErrorRecord.Exception.Response.StatusCode } catch {}
  if ($status) { return "$Uri failed with HTTP ${status}: $message" }
  return "$Uri failed: $message"
}

function Get-LatestVersion {
  $latestApi = "https://api.github.com/repos/$Repo/releases/latest"
  $listApi   = "https://api.github.com/repos/$Repo/releases?per_page=100"
  $delay = 4
  $elapsed = 0
  $maxElapsed = 360
  $lastApiError = $null
  while ($true) {
    try {
      $latest = Invoke-RestMethod -UseBasicParsing -Uri $latestApi
      $found = Test-ReleaseHasInstaller $latest
      if ($found) { return $found }
    } catch {
      $lastApiError = Format-ReleaseApiError $latestApi $_
    }
    try {
      $releases = Invoke-RestMethod -UseBasicParsing -Uri $listApi
      foreach ($release in @($releases)) {
        $found = Test-ReleaseHasInstaller $release
        if ($found) { return $found }
      }
    } catch {
      $lastApiError = Format-ReleaseApiError $listApi $_
    }
    if ($elapsed -ge $maxElapsed) {
      $detail = if ($lastApiError) { " Last API error: $lastApiError" } else { "" }
      Fail "no published release has a ready Windows installer asset after ~${maxElapsed}s; try again shortly or pin `$env:PYTHINKER_VERSION.$detail"
    }
    if ($useAnim) {
      Write-Host -NoNewline ("${ESC}[$($script:ProgressRow);1H${ESC}[K  ${DIM}Waiting${RESET} release assets, retrying in ${BAR}${delay}s${RESET}")
    } else {
      Write-Host "  Waiting for release assets, retrying in ${delay}s"
    }
    Start-Sleep -Seconds $delay
    $elapsed += $delay
    $delay = [Math]::Min($delay * 2, 120)
  }
}

function Wait-ReleaseAssets($version, $asset) {
  $api = "https://api.github.com/repos/$Repo/releases/tags/v$version"
  $delay = 4
  $elapsed = 0
  $maxElapsed = 360
  while ($true) {
    try {
      $release = Invoke-RestMethod -UseBasicParsing -Uri $api
      $names = @($release.assets | ForEach-Object { [string]$_.name })
      if (($names -contains $asset) -and ($names -contains "$asset.sha256")) { return }
    } catch {}
    if ($elapsed -ge $maxElapsed) {
      Fail "release assets for v$version are not available after ~${maxElapsed}s: https://github.com/$Repo/releases/download/v$version/$asset`nThe latest release may still be publishing. Try again shortly, or pin a known-good version with -Version X.Y.Z"
    }
    if ($useAnim) {
      Write-Host -NoNewline ("${ESC}[$($script:ProgressRow);1H${ESC}[K  ${DIM}Waiting${RESET} release assets, retrying in ${BAR}${delay}s${RESET}")
    } else {
      Write-Host "  Waiting for release assets, retrying in ${delay}s"
    }
    Start-Sleep -Seconds $delay
    $elapsed += $delay
    $delay = [Math]::Min($delay * 2, 120)
  }
}

function Read-ExpectedHash($Path) {
  $text = Get-Content -Raw -Path $Path
  $match = [regex]::Match($text, '(?i)[a-f0-9]{64}')
  if (-not $match.Success) { Fail "could not parse SHA-256 from $Path" }
  return $match.Value.ToLowerInvariant()
}

if ($Help) {
  Show-Usage
  exit 0
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  Fail "This installer is for Windows. Use: curl -fsSL $InstallShUrl | bash"
}

if (-not $Version) { $Version = Get-LatestVersion }
$Version = $Version.TrimStart('v')

$asset = "PythinkerSetup-$Version.exe"
$baseUrl = "https://github.com/$Repo/releases/download/v$Version"
$installerUrl = "$baseUrl/$asset"
$shaUrl = "$installerUrl.sha256"

Print-Intro $Version $asset
Wait-ReleaseAssets $Version $asset
if ($useAnim) { Write-Host -NoNewline ("${ESC}[$($script:ProgressRow);1H${ESC}[K") }

$tempRoot = [System.IO.Path]::GetTempPath()
$tempDir = Join-Path $tempRoot ("pythinker-install-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$installerPath = Join-Path $tempDir $asset
$shaPath = "$installerPath.sha256"

try {
  Download-WithProgress $installerUrl $installerPath
  Invoke-WebRequest -UseBasicParsing -Uri $shaUrl -OutFile $shaPath

  $expected = Read-ExpectedHash $shaPath
  $actual = (Get-FileHash -Algorithm SHA256 -Path $installerPath).Hash.ToLowerInvariant()
  if ($expected -ne $actual) {
    Fail "SHA-256 mismatch: expected $expected, got $actual"
  }
  Phase-Ok "Verifying"

  $installerArgs = @(
    '/SILENT',
    '/NORESTART',
    '/CURRENTUSER',
    '/CLOSEAPPLICATIONS',
    '/NORESTARTAPPLICATIONS'
  )
  $process = Start-Process -FilePath $installerPath -ArgumentList $installerArgs -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    Fail "installer exited with code $($process.ExitCode)"
  }
  Phase-Ok "Installing"

  $installDir = Join-Path $env:LOCALAPPDATA "Programs\Pythinker"
  if (Test-Path (Join-Path $installDir "pythinker.exe")) {
    if (($env:PATH -split ';') -notcontains $installDir) {
      $env:PATH = "$installDir;$env:PATH"
    }
  }

  Print-Done
} finally {
  Write-Host -NoNewline $SHOW
  Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}
