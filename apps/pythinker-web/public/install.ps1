# Pythinker Code — native Windows installer.
#
# Downloads the native single-file binary (pythinker-code-win32-<arch>.zip)
# from the GitHub Release matching the CDN's latest version, verifies its
# SHA-256, and installs pythinker.exe to %LOCALAPPDATA%\Programs\Pythinker
# (added to the user PATH).
#
# Usage:
#   irm https://code.pythinker.com/pythinker-code/install.ps1 | iex
#
# To pin a version when running the hosted script, set:
#   $env:PYTHINKER_VERSION = "0.6.0"; irm https://code.pythinker.com/pythinker-code/install.ps1 | iex
#
# Or run the script directly:
#   .\install.ps1 -Version 0.6.0
#
# Terminal controls:
#   $env:PYTHINKER_NO_ANIMATION = "1"   # Disable motion, keep concise output.
#   $env:NO_COLOR = "1"                 # Disable ANSI colors.

[CmdletBinding()]
param(
  [string]$Version = $env:PYTHINKER_VERSION,
  [switch]$Help
)

# Invoke the implementation in a child scope. This matters for the hosted
# `irm ... | iex` form: functions, preferences, and temporary variables must
# not leak into the caller's interactive PowerShell session.
& {
  param(
    [string]$RequestedVersion,
    [bool]$ShowHelp
  )

  $ErrorActionPreference = "Stop"
  Set-StrictMode -Version 2.0

  $Repo = "PyModel/pythinker-code"
  $CdnLatestUrl = "https://code.pythinker.com/pythinker-code/latest"
  $InstallShUrl = "https://code.pythinker.com/pythinker-code/install.sh"
  $InstallPs1Url = "https://code.pythinker.com/pythinker-code/install.ps1"

  # Network timeouts, in seconds. The installer owns retry (helpers re-invoke
  # up to 3 times with backoff), so no client-side retry is used and each bound
  # covers exactly one attempt.
  # - Metadata requests (CDN version, GitHub API, checksum): 30s total.
  # - Archive download: 600s total. Both share a 10s connect cap.
  $ConnectTimeoutSeconds = 10
  $MetadataTimeoutSeconds = 30
  $ArchiveTimeoutSeconds = 600

  $previousOutputEncoding = $null
  $previousSecurityProtocol = $null
  $httpClient = $null
  $installMutex = $null
  $mutexHeld = $false
  $tempDir = $null
  $stagingBinary = $null
  $backupBinary = $null
  $targetPath = $null

  try { $previousOutputEncoding = [Console]::OutputEncoding } catch {}
  try { $previousSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol } catch {}

  try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  } catch {}

  # Add TLS 1.2 without discarding newer protocols selected by the host.
  try {
    $currentProtocols = [Net.ServicePointManager]::SecurityProtocol
    $tls12 = [Net.SecurityProtocolType]::Tls12
    if (($currentProtocols -band $tls12) -eq 0) {
      [Net.ServicePointManager]::SecurityProtocol = $currentProtocols -bor $tls12
    }
  } catch {}

  function Test-EnvironmentVariablePresent([string]$Name) {
    return $null -ne [Environment]::GetEnvironmentVariable($Name, 'Process')
  }

  function Test-InteractiveTerminal {
    try {
      if ([Console]::IsOutputRedirected) { return $false }
      $null = $Host.UI.RawUI.WindowSize
      return $true
    } catch {
      return $false
    }
  }

  function Test-AnsiSupport {
    if (-not (Test-InteractiveTerminal)) { return $false }

    $term = [Environment]::GetEnvironmentVariable('TERM', 'Process')
    if ($term -and $term -ieq 'dumb') { return $false }

    try {
      if ([bool]$Host.UI.SupportsVirtualTerminal) { return $true }
    } catch {}

    if (Test-EnvironmentVariablePresent 'WT_SESSION') { return $true }
    if (Test-EnvironmentVariablePresent 'ANSICON') { return $true }
    if ($env:ConEmuANSI -eq 'ON') { return $true }
    if ($term -and $term -match '(?i)(xterm|ansi|screen|cygwin|msys|vt100)') { return $true }

    return $false
  }

  $interactiveTerminal = Test-InteractiveTerminal
  $ansiSupported = Test-AnsiSupport
  $useColor = $ansiSupported -and -not (Test-EnvironmentVariablePresent 'NO_COLOR')
  $useAnimation = $ansiSupported `
    -and $interactiveTerminal `
    -and -not (Test-EnvironmentVariablePresent 'CI') `
    -and -not (Test-EnvironmentVariablePresent 'PYTHINKER_NO_ANIMATION')

  $ESC = [char]27
  $NAVY = $FACE = $ACCENT = $TIP = $EYE = $BAR = $DIM = $BOLD = $RESET = $SHINE = $SOFT = $ERROR_COLOR = ""
  if ($useColor) {
    $NAVY = "$ESC[38;5;24m"
    $FACE = "$ESC[38;5;255m"
    $ACCENT = "$ESC[38;5;147m"
    $TIP = "$ESC[38;5;216m"
    $EYE = "$ESC[38;5;189m"
    $BAR = "$ESC[38;5;250m"
    $DIM = "$ESC[2m"
    $BOLD = "$ESC[1m"
    $RESET = "$ESC[0m"
    $SHINE = "$ESC[38;5;231m"
    $SOFT = "$ESC[38;5;111m"
    $ERROR_COLOR = "$ESC[38;5;203m"
  }

  $HIDE_CURSOR = ""
  $SHOW_CURSOR = ""
  $CLEAR_LINE = ""
  if ($useAnimation) {
    $HIDE_CURSOR = "$ESC[?25l"
    $SHOW_CURSOR = "$ESC[?25h"
    $CLEAR_LINE = "$ESC[2K"
  }

  function Stop-Installer([string]$Message) {
    throw "Pythinker Code install failed: $Message"
  }

  function Show-Usage {
    @"
Pythinker Code — native Windows installer.

Downloads the native single-file binary (pythinker-code-win32-<arch>.zip)
from the GitHub Release matching the CDN's latest version, verifies its
SHA-256, and installs pythinker.exe to %LOCALAPPDATA%\Programs\Pythinker
(added to the user PATH).

Usage:
  irm $InstallPs1Url | iex

  # Pin a version:
  `$env:PYTHINKER_VERSION = "0.6.0"; irm $InstallPs1Url | iex

  # Or run directly:
  .\install.ps1 -Version 0.6.0

Terminal controls:
  `$env:PYTHINKER_NO_ANIMATION = "1"  # Disable motion.
  `$env:NO_COLOR = "1"                # Disable ANSI colors.

Unix / macOS / Linux users:
  curl -fsSL $InstallShUrl | bash
"@
  }

  function Get-TerminalWidth {
    $width = 80
    try { $width = [int]$Host.UI.RawUI.WindowSize.Width } catch {}
    return [Math]::Max(48, [Math]::Min(120, $width))
  }

  function Get-AnimationDelay([string]$EnvironmentName, [int]$DefaultMilliseconds) {
    $raw = [Environment]::GetEnvironmentVariable($EnvironmentName, 'Process')
    if (-not $raw) { return $DefaultMilliseconds }

    try {
      $milliseconds = [int]([double]$raw * 1000)
      return [Math]::Max(0, [Math]::Min(2000, $milliseconds))
    } catch {
      return $DefaultMilliseconds
    }
  }

  function Write-Logo {
    $frameDelay = Get-AnimationDelay 'PYTHINKER_LOGO_FRAME_DELAY' 45
    $taglineDelay = Get-AnimationDelay 'PYTHINKER_LOGO_STAGGER_DELAY' 14

    $logo = @(
      "      ${TIP}●${RESET}",
      "      ${NAVY}│${RESET}",
      "  ${NAVY}▛${RESET}${FACE}▀▀▀▀▀▀▀${RESET}${NAVY}▜${RESET}",
      " ${TIP}◖${RESET}${NAVY}█${RESET} ${EYE}◉${RESET}   ${EYE}◉${RESET} ${NAVY}█${RESET}${TIP}◗${RESET}",
      "  ${NAVY}▙▄▄▄${RESET}${FACE}≡${RESET}${NAVY}▄▄▄▟${RESET}"
    )

    Write-Host ""
    foreach ($line in $logo) {
      Write-Host $line
      if ($useAnimation -and $frameDelay -gt 0) {
        Start-Sleep -Milliseconds $frameDelay
      }
    }

    $tagline = "Pythinker Code  Think first. Then code."
    Write-Host ""
    Write-Host -NoNewline "  "
    if ($useAnimation) {
      foreach ($character in $tagline.ToCharArray()) {
        Write-Host -NoNewline $character
        if ($taglineDelay -gt 0) { Start-Sleep -Milliseconds $taglineDelay }
      }
      Write-Host ""
    } else {
      Write-Host $tagline
    }
    Write-Host ""
  }

  function Write-MetadataRow([string]$Label, [string]$Value) {
    Write-Host ("  {0}{1,-10}{2} {3}" -f $DIM, $Label, $RESET, $Value)
  }

  function Write-PhaseOk([string]$Label, [string]$Detail) {
    $suffix = if ($Detail) { " ${DIM}$Detail${RESET}" } else { "" }
    Write-Host ("  ${ACCENT}✓${RESET} {0,-10}{1}" -f $Label, $suffix)
  }

  function Write-PhaseInfo([string]$Label, [string]$Detail) {
    Write-Host ("  ${SOFT}•${RESET} {0,-10} ${DIM}{1}${RESET}" -f $Label, $Detail)
  }

  function Write-RetryLine([string]$Label, [int]$Attempt, [int]$DelaySeconds, [string]$Reason) {
    if ($useAnimation) {
      Write-Host -NoNewline ("`r${CLEAR_LINE}")
    }
    Write-Host ("  ${TIP}↻${RESET} {0,-10} retry {1}/3 in {2}s ${DIM}{3}${RESET}" -f $Label, $Attempt, $DelaySeconds, $Reason)
  }

  function Format-ByteSize([long]$Bytes) {
    if ($Bytes -lt 1024) { return "$Bytes B" }
    if ($Bytes -lt 1MB) { return ("{0:N1} KB" -f ($Bytes / 1KB)) }
    if ($Bytes -lt 1GB) { return ("{0:N1} MB" -f ($Bytes / 1MB)) }
    return ("{0:N2} GB" -f ($Bytes / 1GB))
  }

  function Write-DownloadStarted([string]$Label) {
    Write-Host ("  ${SOFT}↓${RESET} {0,-10} ${DIM}starting…${RESET}" -f $Label)
  }

  function Write-DownloadProgress(
    [long]$ReceivedBytes,
    $TotalBytes,
    [double]$ElapsedSeconds,
    [int]$FrameIndex
  ) {
    if (-not $useAnimation) { return }

    $spinnerFrames = @('●', '◐', '◓', '◑', '◒')
    $spinner = $spinnerFrames[$FrameIndex % $spinnerFrames.Length]
    $terminalWidth = Get-TerminalWidth
    $barWidth = [Math]::Max(12, [Math]::Min(40, $terminalWidth - 44))
    $rate = if ($ElapsedSeconds -gt 0.05) { [long]($ReceivedBytes / $ElapsedSeconds) } else { 0 }
    $rateText = if ($rate -gt 0) { "$(Format-ByteSize $rate)/s" } else { "—/s" }

    if ($null -ne $TotalBytes -and [long]$TotalBytes -gt 0) {
      $total = [long]$TotalBytes
      $percent = [Math]::Min(100, [Math]::Floor(($ReceivedBytes * 100.0) / $total))
      $filled = [int][Math]::Floor(($percent * $barWidth) / 100)
      $empty = $barWidth - $filled
      $barText = ("━" * $filled) + ("─" * $empty)
      $metrics = "{0,3}% {1}/{2} {3}" -f $percent, (Format-ByteSize $ReceivedBytes), (Format-ByteSize $total), $rateText
      $line = "  ${ACCENT}${spinner}${RESET} Download   ${BAR}${barText}${RESET} $metrics"
    } else {
      $position = $FrameIndex % $barWidth
      $left = "─" * $position
      $rightCount = [Math]::Max(0, $barWidth - $position - 1)
      $right = "─" * $rightCount
      $barText = "${left}${SHINE}◆${RESET}${BAR}${right}"
      $line = "  ${ACCENT}${spinner}${RESET} Download   ${BAR}${barText}${RESET} $(Format-ByteSize $ReceivedBytes) $rateText"
    }

    Write-Host -NoNewline ("`r${CLEAR_LINE}${line}")
  }

  function Write-DownloadComplete([long]$Bytes, [double]$ElapsedSeconds) {
    if ($useAnimation) {
      Write-Host -NoNewline ("`r${CLEAR_LINE}")
    }

    $duration = [Math]::Max(0.01, $ElapsedSeconds)
    $averageRate = [long]($Bytes / $duration)
    Write-Host ("  ${ACCENT}✓${RESET} {0,-10} {1} ${DIM}in {2:N1}s · {3}/s${RESET}" -f 'Download', (Format-ByteSize $Bytes), $duration, (Format-ByteSize $averageRate))
  }

  function New-InstallerHttpClient {
    try {
      Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
    } catch {
      Stop-Installer "System.Net.Http is unavailable: $($_.Exception.Message)"
    }

    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $true
    # Connect cap: 10s. HttpClientHandler.ConnectTimeout is available on
    # PowerShell 7 (System.Net.Http on .NET Core) and on Windows PowerShell 5.1
    # hosts with .NET Framework 4.7.2+; the guard below skips it on older .NET
    # Framework hosts, where the operation timeout still bounds the whole call.
    try {
      $handler.ConnectTimeout = [TimeSpan]::FromSeconds($ConnectTimeoutSeconds)
    } catch {
      # Older .NET Framework without ConnectTimeout: nothing to set; the
      # operation timeout below still bounds the call.
    }
    $client = New-Object System.Net.Http.HttpClient -ArgumentList $handler
    # Operation timeout: 30s, and never reassigned — the setter throws once the
    # client has sent its first request. For the metadata calls, which read with
    # ResponseContentRead, this covers the whole operation (request, headers and
    # body) on both PowerShell 7 and Windows PowerShell 5.1. The archive
    # download bounds itself with a cancellation token; see Download-File.
    $client.Timeout = [TimeSpan]::FromSeconds($MetadataTimeoutSeconds)
    [void]$client.DefaultRequestHeaders.UserAgent.ParseAdd('Pythinker-Code-Installer/1.0')
    [void]$client.DefaultRequestHeaders.Accept.ParseAdd('*/*')
    return $client
  }

  function Get-HttpTextOnce($Client, [string]$Uri, [string]$Description) {
    $response = $null
    try {
      $response = $Client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseContentRead).GetAwaiter().GetResult()
      if (-not $response.IsSuccessStatusCode) {
        $status = [int]$response.StatusCode
        throw "$Description failed with HTTP $status $($response.ReasonPhrase)"
      }
      return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    } finally {
      if ($null -ne $response) { $response.Dispose() }
    }
  }

  function Get-HttpText($Client, [string]$Uri, [string]$Description) {
    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        return Get-HttpTextOnce $Client $Uri $Description
      } catch {
        $lastError = $_.Exception.Message
        if ($attempt -lt 3) {
          $delay = [Math]::Pow(2, $attempt - 1)
          Write-RetryLine $Description ($attempt + 1) ([int]$delay) $lastError
          Start-Sleep -Seconds $delay
        }
      }
    }
    throw "$Description failed after 3 attempts: $lastError"
  }

  function Get-HttpJson($Client, [string]$Uri, [switch]$AllowNotFound) {
    $response = $null
    try {
      $response = $Client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseContentRead).GetAwaiter().GetResult()
      $status = [int]$response.StatusCode
      if ($AllowNotFound -and $status -eq 404) { return $null }
      if (-not $response.IsSuccessStatusCode) {
        throw "GitHub API failed with HTTP $status $($response.ReasonPhrase)"
      }
      $json = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      return $json | ConvertFrom-Json
    } finally {
      if ($null -ne $response) { $response.Dispose() }
    }
  }

  # Machine-readable progress for the parent process, mirroring install.sh.
  # The background installer has no TTY, so stdout stays human-only (and is
  # discarded by the spawn) and stderr carries the protocol: one
  # newline-terminated line per update. Without these lines a Windows update in
  # flight is indistinguishable from a wedged one.
  function Write-MachineProgress([string]$Fields) {
    try { [Console]::Error.WriteLine("progress: $Fields") } catch {}
  }

  function Write-MachineDownloadProgress([long]$Received, $TotalBytes) {
    if ($null -ne $TotalBytes -and [long]$TotalBytes -gt 0) {
      $percent = [int][Math]::Floor(($Received * 100) / [long]$TotalBytes)
      if ($percent -gt 100) { $percent = 100 }
      Write-MachineProgress "state=downloading percent=$percent transferred=$Received total=$([long]$TotalBytes)"
    } else {
      Write-MachineProgress "state=downloading transferred=$Received"
    }
  }

  function Download-File($Client, [string]$Uri, [string]$Destination, [string]$Label) {
    $lastError = $null

    for ($attempt = 1; $attempt -le 3; $attempt++) {
      $partialPath = "$Destination.part"
      $response = $null
      $inputStream = $null
      $outputStream = $null
      $stopwatch = $null
      $attemptCts = $null
      $received = [long]0
      $frameIndex = 0

      Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue

      if (-not $useAnimation) {
        Write-DownloadStarted $Label
      }

      try {
        if ($useAnimation) { Write-Host -NoNewline $HIDE_CURSOR }

        # Archive download: bounded by a cancellation token, not by
        # HttpClient.Timeout. Two reasons the property cannot do this job.
        # First, its setter throws InvalidOperationException once the client has
        # sent a request, and metadata calls have already run by the time we get
        # here. Second, with ResponseHeadersRead it only bounds the wait for the
        # headers, never the streaming body — so a connection that accepts and
        # then stops would hang the installer forever, with its pid still
        # recorded as the active update.
        # One token covers the header wait and every read below.
        # Total ceiling only, no per-read stall guard: curl's --speed-time
        # equivalent needs a token per read. Add it if a 600s trickle ever
        # shows up in the wild.
        $attemptCts = New-Object System.Threading.CancellationTokenSource
        $attemptCts.CancelAfter([TimeSpan]::FromSeconds($ArchiveTimeoutSeconds))

        $response = $Client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $attemptCts.Token).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
          $status = [int]$response.StatusCode
          throw "$Label failed with HTTP $status $($response.ReasonPhrase)"
        }

        $totalBytes = $response.Content.Headers.ContentLength
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [System.IO.File]::Open(
          $partialPath,
          [System.IO.FileMode]::Create,
          [System.IO.FileAccess]::Write,
          [System.IO.FileShare]::None
        )

        $buffer = New-Object byte[] 131072
        $stopwatch = [Diagnostics.Stopwatch]::StartNew()
        $lastRenderMilliseconds = [long]-1000
        $lastMachineMilliseconds = [long]-1000

        Write-MachineDownloadProgress $received $totalBytes

        while ($true) {
          $read = $inputStream.ReadAsync($buffer, 0, $buffer.Length, $attemptCts.Token).GetAwaiter().GetResult()
          if ($read -le 0) { break }

          $outputStream.Write($buffer, 0, $read)
          $received += $read

          if ($useAnimation -and ($stopwatch.ElapsedMilliseconds - $lastRenderMilliseconds) -ge 80) {
            Write-DownloadProgress $received $totalBytes $stopwatch.Elapsed.TotalSeconds $frameIndex
            $lastRenderMilliseconds = $stopwatch.ElapsedMilliseconds
            $frameIndex++
          }

          # One line per second at most: the parent throttles its own writes,
          # and the pipe is shared with the failure tail.
          if (($stopwatch.ElapsedMilliseconds - $lastMachineMilliseconds) -ge 1000) {
            Write-MachineDownloadProgress $received $totalBytes
            $lastMachineMilliseconds = $stopwatch.ElapsedMilliseconds
          }
        }

        $outputStream.Flush($true)
        $outputStream.Dispose()
        $outputStream = $null
        $inputStream.Dispose()
        $inputStream = $null
        $response.Dispose()
        $response = $null
        $stopwatch.Stop()

        if ($null -ne $totalBytes -and [long]$totalBytes -gt 0 -and $received -ne [long]$totalBytes) {
          throw "$Label was truncated: expected $totalBytes bytes, received $received"
        }
        if ($received -le 0) { throw "$Label returned an empty file" }

        [System.IO.File]::Move($partialPath, $Destination)
        Write-MachineProgress "state=done transferred=$received"
        Write-DownloadComplete $received $stopwatch.Elapsed.TotalSeconds
        return
      } catch {
        $lastError = $_.Exception.Message
      } finally {
        if ($null -ne $outputStream) { $outputStream.Dispose() }
        if ($null -ne $inputStream) { $inputStream.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
        if ($null -ne $attemptCts) { $attemptCts.Dispose() }
        if ($null -ne $stopwatch -and $stopwatch.IsRunning) { $stopwatch.Stop() }
        Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        if ($useAnimation) {
          Write-Host -NoNewline ("`r${CLEAR_LINE}${SHOW_CURSOR}")
        }
      }

      if ($attempt -lt 3) {
        $delay = [Math]::Pow(2, $attempt - 1)
        Write-RetryLine $Label ($attempt + 1) ([int]$delay) $lastError
        Start-Sleep -Seconds $delay
      }
    }

    # Emitted once, after the last attempt: a `failed` line between retries
    # would drop the parent's footer out of its downloading state and back to
    # a failure it is about to recover from.
    Write-MachineProgress 'state=failed'
    Stop-Installer "$Label failed after 3 attempts: $lastError"
  }

  function Test-Version([string]$Candidate) {
    return $Candidate -match '^\d+\.\d+\.\d+$'
  }

  function Get-ReleaseTag([string]$ResolvedVersion) {
    return "@pythoughts/pythinker-code@$ResolvedVersion"
  }

  function Get-EncodedReleaseTag([string]$ResolvedVersion) {
    return [uri]::EscapeDataString((Get-ReleaseTag $ResolvedVersion))
  }

  function Test-ReleaseHasAsset($Release, [string]$AssetName) {
    if ($null -eq $Release) { return $false }
    if ($Release.draft -or $Release.prerelease) { return $false }
    $names = @($Release.assets | ForEach-Object { [string]$_.name })
    return (($names -contains $AssetName) -and ($names -contains "$AssetName.sha256"))
  }

  function Get-LatestVersion($Client) {
    try {
      $raw = Get-HttpText $Client $CdnLatestUrl 'CDN latest version'
      $candidate = ([string]$raw).Trim().Trim('"')
      if (Test-Version $candidate) { return $candidate }
    } catch {
      Write-PhaseInfo 'Version' 'CDN unavailable; using GitHub release metadata'
    }

    $latestApi = "https://api.github.com/repos/$Repo/releases/latest"
    try {
      $latest = Get-HttpJson $Client $latestApi
      $tag = [string]$latest.tag_name
      if ($tag -match '^@pythoughts/pythinker-code@(\d+\.\d+\.\d+)$') {
        return $Matches[1]
      }
      Stop-Installer "could not parse latest release tag '$tag' from GitHub"
    } catch {
      Stop-Installer "could not resolve the latest version: $($_.Exception.Message)"
    }
  }

  function Wait-ReleaseAssets($Client, [string]$ResolvedVersion, [string]$AssetName) {
    $api = "https://api.github.com/repos/$Repo/releases/tags/$(Get-EncodedReleaseTag $ResolvedVersion)"
    $delay = 4
    $elapsed = 0
    $maxElapsed = 360
    $frame = 0
    $lastError = $null

    while ($true) {
      try {
        $release = Get-HttpJson $Client $api -AllowNotFound
        if (Test-ReleaseHasAsset $release $AssetName) {
          if ($useAnimation) { Write-Host -NoNewline ("`r${CLEAR_LINE}") }
          Write-PhaseOk 'Release' 'assets ready'
          return
        }
      } catch {
        $lastError = $_.Exception.Message
        if ($lastError -match 'HTTP (401|403)') {
          Stop-Installer $lastError
        }
      }

      if ($elapsed -ge $maxElapsed) {
        $detail = if ($lastError) { " Last error: $lastError" } else { "" }
        Stop-Installer "release assets for $ResolvedVersion were not available after ${maxElapsed}s.$detail"
      }

      Write-MachineProgress "state=waiting retry_in=$delay elapsed=$elapsed"

      if ($useAnimation) {
        $waitFrames = @('◐', '◓', '◑', '◒')
        for ($remaining = $delay; $remaining -gt 0; $remaining--) {
          $glyph = $waitFrames[$frame % $waitFrames.Length]
          Write-Host -NoNewline ("`r${CLEAR_LINE}  ${ACCENT}${glyph}${RESET} Release    ${DIM}waiting for assets · retry in ${remaining}s${RESET}")
          Start-Sleep -Seconds 1
          $elapsed++
          $frame++
          if ($elapsed -ge $maxElapsed) { break }
        }
      } else {
        Write-Host ("  ${SOFT}•${RESET} Release    waiting for assets; retrying in ${delay}s")
        Start-Sleep -Seconds $delay
        $elapsed += $delay
      }

      $delay = [Math]::Min($delay * 2, 60)
    }
  }

  function Read-ExpectedHash([string]$Path, [string]$ExpectedFileName) {
    $candidates = @()

    foreach ($line in Get-Content -LiteralPath $Path) {
      $trimmed = ([string]$line).Trim()
      if (-not $trimmed) { continue }

      if ($trimmed -match '^(?<hash>[A-Fa-f0-9]{64})\s+\*?(?<name>.+?)\s*$') {
        $candidates += [pscustomobject]@{
          Hash = $Matches.hash.ToLowerInvariant()
          Name = $Matches.name.Trim()
        }
        continue
      }

      if ($trimmed -match '^SHA256\s*\((?<name>.+?)\)\s*=\s*(?<hash>[A-Fa-f0-9]{64})$') {
        $candidates += [pscustomobject]@{
          Hash = $Matches.hash.ToLowerInvariant()
          Name = $Matches.name.Trim()
        }
        continue
      }

      if ($trimmed -match '^(?<hash>[A-Fa-f0-9]{64})$') {
        $candidates += [pscustomobject]@{
          Hash = $Matches.hash.ToLowerInvariant()
          Name = $null
        }
      }
    }

    $namedMatches = @($candidates | Where-Object {
      $_.Name -and ([System.IO.Path]::GetFileName([string]$_.Name) -ieq $ExpectedFileName)
    })

    if ($namedMatches.Count -eq 1) { return [string]$namedMatches[0].Hash }

    $unnamedMatches = @($candidates | Where-Object { -not $_.Name })
    if ($candidates.Count -eq 1 -and $unnamedMatches.Count -eq 1) {
      return [string]$unnamedMatches[0].Hash
    }

    Stop-Installer "checksum file did not contain a SHA-256 entry for '$ExpectedFileName'"
  }

  function Expand-VerifiedBinary([string]$ArchivePath, [string]$DestinationPath) {
    try {
      Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
      Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    } catch {
      Stop-Installer "ZIP support is unavailable: $($_.Exception.Message)"
    }

    $archive = $null
    $entryStream = $null
    $destinationStream = $null

    try {
      $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
      $files = @($archive.Entries | Where-Object { -not [string]::IsNullOrEmpty($_.Name) })

      if ($files.Count -ne 1) {
        Stop-Installer "archive must contain exactly one root file named pythinker.exe; found $($files.Count) files"
      }

      $entry = $files[0]
      $entryPath = ([string]$entry.FullName).Replace('\', '/')
      if ($entryPath -cne 'pythinker.exe') {
        Stop-Installer "archive must contain exactly one root file named pythinker.exe; found '$entryPath'"
      }
      if ([long]$entry.Length -le 0) {
        Stop-Installer "archive contained an empty pythinker.exe"
      }

      $entryStream = $entry.Open()
      $destinationStream = [System.IO.File]::Open(
        $DestinationPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
      )
      $entryStream.CopyTo($destinationStream)
      $destinationStream.Flush($true)
    } finally {
      if ($null -ne $destinationStream) { $destinationStream.Dispose() }
      if ($null -ne $entryStream) { $entryStream.Dispose() }
      if ($null -ne $archive) { $archive.Dispose() }
    }
  }

  function Move-FileWithRetry(
    [string]$Source,
    [string]$Destination,
    [string]$Description,
    [int]$Attempts = 6
  ) {
    $lastError = $null
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
      try {
        [System.IO.File]::Move($Source, $Destination)
        return
      } catch {
        $lastError = $_.Exception.Message
        if ($attempt -lt $Attempts) {
          Start-Sleep -Milliseconds ([Math]::Min(1500, 200 * $attempt))
        }
      }
    }
    throw "$Description failed after $Attempts attempts: $lastError"
  }

  function Remove-FileWithRetry([string]$Path, [int]$Attempts = 5) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
      if (-not (Test-Path -LiteralPath $Path)) { return $true }
      try {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        return $true
      } catch {
        if ($attempt -lt $Attempts) { Start-Sleep -Milliseconds (250 * $attempt) }
      }
    }
    return -not (Test-Path -LiteralPath $Path)
  }

  function Repair-InterruptedInstall([string]$BinaryPath) {
    $directory = [System.IO.Path]::GetDirectoryName($BinaryPath)
    $leaf = [System.IO.Path]::GetFileName($BinaryPath)
    $backups = @(Get-ChildItem -LiteralPath $directory -Filter "$leaf.old-*" -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending)

    if (-not (Test-Path -LiteralPath $BinaryPath) -and $backups.Count -gt 0) {
      Move-FileWithRetry $backups[0].FullName $BinaryPath 'recovery of the previous executable'
      Write-PhaseOk 'Recovery' 'restored an interrupted prior update'
      $backups = @($backups | Select-Object -Skip 1)
    }

    if (Test-Path -LiteralPath $BinaryPath) {
      foreach ($backup in $backups) {
        [void](Remove-FileWithRetry $backup.FullName 2)
      }
    }

    foreach ($stale in Get-ChildItem -LiteralPath $directory -Filter "$leaf.new-*" -File -ErrorAction SilentlyContinue) {
      [void](Remove-FileWithRetry $stale.FullName 2)
    }
  }

  function Normalize-PathEntry([string]$PathEntry) {
    if ([string]::IsNullOrWhiteSpace($PathEntry)) { return "" }

    $clean = $PathEntry.Trim().Trim('"')
    $expanded = [Environment]::ExpandEnvironmentVariables($clean)
    try { $expanded = [System.IO.Path]::GetFullPath($expanded) } catch {}
    return $expanded.TrimEnd([char[]]@('\', '/'))
  }

  function Test-PathContains([string]$PathValue, [string]$Entry) {
    $normalizedEntry = Normalize-PathEntry $Entry
    foreach ($candidate in ($PathValue -split ';')) {
      if ((Normalize-PathEntry $candidate) -ieq $normalizedEntry) { return $true }
    }
    return $false
  }

  function Add-InstallDirectoryToPath([string]$InstallDirectory) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $added = $false

    if (-not (Test-PathContains $userPath $InstallDirectory)) {
      $newPath = if ($userPath) { "$InstallDirectory;$userPath" } else { $InstallDirectory }
      [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
      $added = $true
    }

    if (-not (Test-PathContains $env:PATH $InstallDirectory)) {
      $env:PATH = "$InstallDirectory;$env:PATH"
    }

    return $added
  }

  function Get-NativeArchitecture {
    try {
      $registry = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -ErrorAction Stop
      if ($registry.PROCESSOR_ARCHITECTURE) { return [string]$registry.PROCESSOR_ARCHITECTURE }
    } catch {}

    if ($env:PROCESSOR_ARCHITEW6432) { return [string]$env:PROCESSOR_ARCHITEW6432 }
    return [string]$env:PROCESSOR_ARCHITECTURE
  }

  function Print-Intro([string]$ResolvedVersion, [string]$PlatformDisplay, [string]$AssetName, [string]$Action) {
    Write-Logo
    Write-MetadataRow 'Version' $ResolvedVersion
    Write-MetadataRow 'Platform' $PlatformDisplay
    Write-MetadataRow 'Package' $AssetName
    Write-MetadataRow 'Action' $Action
    Write-Host ""
  }

  function Print-Done([string]$ResolvedVersion, [string]$BinaryPath, [bool]$PathWasAdded) {
    $separatorWidth = [Math]::Max(36, [Math]::Min(58, (Get-TerminalWidth) - 4))
    $separator = "─" * $separatorWidth

    Write-Host ""
    Write-Host "  ${BAR}${separator}${RESET}"
    Write-Host "  ${ACCENT}${BOLD}✓ Pythinker Code $ResolvedVersion is ready${RESET}"
    Write-Host ""
    Write-Host "      ${DIM}Run${RESET}        ${BOLD}pythinker${RESET}"
    Write-Host "      ${DIM}Installed${RESET}  $BinaryPath"
    if ($PathWasAdded) {
      Write-Host "      ${DIM}PATH${RESET}       Added for this user and this session"
    } else {
      Write-Host "      ${DIM}PATH${RESET}       Already configured"
    }
    Write-Host "  ${BAR}${separator}${RESET}"
    Write-Host ""
  }

  try {
    if ($ShowHelp) {
      Show-Usage
      return
    }

    if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
      Stop-Installer "this installer is for Windows. Use: curl -fsSL $InstallShUrl | bash"
    }

    $httpClient = New-InstallerHttpClient

    $resolvedVersion = ([string]$RequestedVersion).Trim()
    if ($resolvedVersion.StartsWith('v', [StringComparison]::OrdinalIgnoreCase)) {
      $resolvedVersion = $resolvedVersion.Substring(1)
    }
    if (-not $resolvedVersion) {
      $resolvedVersion = Get-LatestVersion $httpClient
    }
    if (-not (Test-Version $resolvedVersion)) {
      Stop-Installer "invalid version '$resolvedVersion'; expected X.Y.Z"
    }

    $nativeArchitecture = (Get-NativeArchitecture).ToUpperInvariant()
    switch ($nativeArchitecture) {
      'ARM64' { $archLabel = 'arm64' }
      'AMD64' { $archLabel = 'x64' }
      default { Stop-Installer "unsupported Windows architecture '$nativeArchitecture' (need x64 or arm64)" }
    }

    $localAppData = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
    if (-not $localAppData) { $localAppData = $env:LOCALAPPDATA }
    if (-not $localAppData) { Stop-Installer 'could not resolve LOCALAPPDATA' }

    $installDir = Join-Path $localAppData 'Programs\Pythinker'
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    $targetPath = Join-Path $installDir 'pythinker.exe'

    $mutexUser = ([Environment]::UserName -replace '[^A-Za-z0-9_.-]', '_')
    $mutexName = "Local\PythinkerCodeInstaller-$mutexUser"
    $installMutex = New-Object System.Threading.Mutex($false, $mutexName)
    try {
      $mutexHeld = $installMutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      $mutexHeld = $true
    }
    if (-not $mutexHeld) {
      Stop-Installer 'another Pythinker installer or update is already running'
    }

    Repair-InterruptedInstall $targetPath
    $action = if (Test-Path -LiteralPath $targetPath) { 'Upgrade' } else { 'Install' }

    $asset = "pythinker-code-win32-$archLabel.zip"
    $baseUrl = "https://github.com/$Repo/releases/download/$(Get-EncodedReleaseTag $resolvedVersion)"
    $installerUrl = "$baseUrl/$asset"
    $shaUrl = "$installerUrl.sha256"

    Print-Intro $resolvedVersion "Windows $archLabel" $asset $action
    Wait-ReleaseAssets $httpClient $resolvedVersion $asset

    $tempRoot = [System.IO.Path]::GetTempPath()
    $tempDir = Join-Path $tempRoot ("pythinker-install-" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    $installerPath = Join-Path $tempDir $asset
    $shaPath = "$installerPath.sha256"

    Download-File $httpClient $installerUrl $installerPath 'Download'
    $checksumText = Get-HttpText $httpClient $shaUrl 'Checksum'
    [System.IO.File]::WriteAllText($shaPath, $checksumText, [System.Text.Encoding]::ASCII)

    $expectedHash = Read-ExpectedHash $shaPath $asset
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath).Hash.ToLowerInvariant()
    if ($expectedHash -ne $actualHash) {
      Stop-Installer "SHA-256 mismatch: expected $expectedHash, got $actualHash"
    }
    Write-PhaseOk 'Verify' ("SHA-256 {0}…" -f $actualHash.Substring(0, 12))

    $transactionId = [System.Guid]::NewGuid().ToString('N')
    $stagingBinary = Join-Path $installDir "pythinker.exe.new-$transactionId"
    Expand-VerifiedBinary $installerPath $stagingBinary

    if (Test-Path -LiteralPath $targetPath) {
      $backupBinary = Join-Path $installDir "pythinker.exe.old-$transactionId"
      try {
        Move-FileWithRetry $targetPath $backupBinary 'moving the existing executable aside'
      } catch {
        Stop-Installer "could not prepare the current installation for update: $($_.Exception.Message)"
      }
    }

    try {
      Move-FileWithRetry $stagingBinary $targetPath 'installing the new executable'
      $stagingBinary = $null
    } catch {
      $installError = $_.Exception.Message
      $rollbackError = $null

      # Roll back the previous executable whenever the new same-volume rename
      # cannot complete. The user is never intentionally left without a binary.
      if ($backupBinary -and (Test-Path -LiteralPath $backupBinary) -and -not (Test-Path -LiteralPath $targetPath)) {
        try {
          Move-FileWithRetry $backupBinary $targetPath 'rollback of the previous executable'
          $backupBinary = $null
        } catch {
          $rollbackError = $_.Exception.Message
        }
      }

      if ($rollbackError) {
        Stop-Installer "could not install the new executable ($installError); rollback also failed ($rollbackError)"
      }
      Stop-Installer "could not install the new executable: $installError"
    }

    if ($backupBinary -and (Test-Path -LiteralPath $backupBinary)) {
      [void](Remove-FileWithRetry $backupBinary 5)
      if (-not (Test-Path -LiteralPath $backupBinary)) { $backupBinary = $null }
    }
    Write-PhaseOk 'Install' $targetPath

    $pathWasAdded = Add-InstallDirectoryToPath $installDir
    if ($pathWasAdded) {
      Write-PhaseOk 'PATH' 'added for this user'
    } else {
      Write-PhaseOk 'PATH' 'already configured'
    }

    Print-Done $resolvedVersion $targetPath $pathWasAdded
  } finally {
    if ($useAnimation) {
      Write-Host -NoNewline ("`r${CLEAR_LINE}${SHOW_CURSOR}")
    }

    if ($null -ne $httpClient) { $httpClient.Dispose() }

    if ($tempDir -and (Test-Path -LiteralPath $tempDir)) {
      Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    if ($stagingBinary -and (Test-Path -LiteralPath $stagingBinary)) {
      [void](Remove-FileWithRetry $stagingBinary 2)
    }

    # A backup is safe to remove only after the target exists. If rollback did
    # not complete, preserve the backup for manual recovery instead of deleting it.
    if ($backupBinary -and $targetPath -and (Test-Path -LiteralPath $targetPath) -and (Test-Path -LiteralPath $backupBinary)) {
      [void](Remove-FileWithRetry $backupBinary 2)
    }

    if ($mutexHeld -and $null -ne $installMutex) {
      try { $installMutex.ReleaseMutex() } catch {}
    }
    if ($null -ne $installMutex) { $installMutex.Dispose() }

    if ($null -ne $previousOutputEncoding) {
      try { [Console]::OutputEncoding = $previousOutputEncoding } catch {}
    }
    if ($null -ne $previousSecurityProtocol) {
      try { [Net.ServicePointManager]::SecurityProtocol = $previousSecurityProtocol } catch {}
    }
  }
} $Version ([bool]$Help)
