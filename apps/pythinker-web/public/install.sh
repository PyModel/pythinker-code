#!/usr/bin/env bash
# Pythinker Code — polished native curl-bash installer.
#
# Downloads the native single-file binary (Node SEA) for the current OS and
# architecture, verifies its SHA-256 checksum, and installs it at:
#   ~/.local/bin/pythinker
#
# Usage:
#   curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash
#
# Pin a version:
#   curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash -s -- --version 0.6.0
#
# Choose an install prefix:
#   curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash -s -- --prefix /opt/pythinker
#
# Supported release targets:
#   linux-x64, linux-arm64, darwin-arm64, darwin-x64
#
# Windows:
#   irm https://code.pythinker.com/pythinker-code/install.ps1 | iex
set -euo pipefail

VERSION=""
INSTALL_PREFIX="${PYTHINKER_INSTALL_PREFIX:-$HOME/.local}"
NO_COLOR="${NO_COLOR:-}"

REPO="Pythoughts-labs/pythinker-code"
CDN_LATEST_URL="https://code.pythinker.com/pythinker-code/latest"

# Network timeout policy. The script owns retry — _download_with_progress and
# _download_quiet_with_retry re-invoke the helpers up to 3 times with backoff —
# so curl and wget must not add their own retry: curl's --max-time counter
# resets on every --retry attempt, which would let one logical attempt run far
# beyond its budget. With retry left to the script, --max-time bounds exactly
# one attempt, which is what the retry loops expect.
#
# Metadata requests (_content_length, _fetch): 10s connect, 30s total.
# Archive downloads (_download_quiet, _start_download): 10s connect, 600s total,
# plus a stall guard that aborts when throughput stays under 1024 bytes/s for
# 30s — a connection that is alive but crawling would otherwise burn the whole
# 600s budget.
# wget gets `-T` and nothing else on purpose. GNU's --connect-timeout /
# --read-timeout / --tries do not exist in BusyBox wget, which is the only wget
# on Alpine-class systems, and an unrecognized option there aborts the install
# outright — turning a working fallback into a hard failure. `-T` is understood
# by both: GNU treats it as dns+connect+read at once, BusyBox as the network
# read timeout. It is an inactivity bound, not a total one, so it is sized for
# "this connection is dead", not for the whole transfer.
CURL_META_OPTS=(--connect-timeout 10 --max-time 30)
WGET_META_OPTS=(-T 30)
CURL_ARCHIVE_OPTS=(--connect-timeout 10 --max-time 600 --speed-limit 1024 --speed-time 30)
WGET_ARCHIVE_OPTS=(-T 60)

# Operational globals are populated by main(). Keeping rendering helpers at
# file scope makes the installer sourceable for regression tests and tooling.
target=""
platform_display=""
tag_encoded=""
archive=""
archive_url=""
sha_url=""
bin_dir=""
install_path=""
TMP_DIR=""
DOWNLOAD_PID=""

# UI globals are initialized to empty so helper functions are safe before
# _init_ui is called (for example, when the file is sourced by a test).
_anim=""
_cursor_hidden=""
ROBOT=""
FACE=""
ACCENT=""
TIP=""
EYE=""
SUCCESS=""
WARNING=""
ERROR_COLOR=""
MUTED=""
BORDER=""
BOLD=""
DIM=""
RESET=""

usage() {
  cat <<'EOF_USAGE'
Pythinker Code — native curl-bash installer.

Downloads the native single-file binary for your OS and architecture,
verifies its SHA-256 checksum, and installs it at:
  ~/.local/bin/pythinker

Usage:
  curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash

Pin a specific version:
  curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash -s -- --version 0.6.0

Use a custom install prefix (default: $HOME/.local):
  curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash -s -- --prefix /opt/pythinker

Supported targets:
  linux-x64        Linux x86_64
  linux-arm64      Linux ARM64
  darwin-arm64     macOS Apple Silicon
  darwin-x64       macOS Intel

Environment:
  PYTHINKER_INSTALL_PREFIX   Default install prefix
  PYTHINKER_NO_ANIMATION     Disable terminal animation when non-empty
  PYTHINKER_TERM_WIDTH       Override detected width
  NO_COLOR                   Disable ANSI colors and animation

Windows:
  irm https://code.pythinker.com/pythinker-code/install.ps1 | iex
EOF_USAGE
}

_parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        [[ -n "${2:-}" ]] || {
          printf '%s\n' '--version requires a value' >&2
          return 2
        }
        VERSION="$2"
        shift 2
        ;;
      --prefix)
        [[ -n "${2:-}" ]] || {
          printf '%s\n' '--prefix requires a value' >&2
          return 2
        }
        INSTALL_PREFIX="$2"
        shift 2
        ;;
      -h|--help)
        usage
        return 10
        ;;
      *)
        printf 'unknown argument: %s\n' "$1" >&2
        return 2
        ;;
    esac
  done
}

_init_ui() {
  # Reset first so repeated calls while sourced are deterministic.
  _anim=""
  ROBOT=""; FACE=""; ACCENT=""; TIP=""; EYE=""; SUCCESS=""
  WARNING=""; ERROR_COLOR=""; MUTED=""; BORDER=""
  BOLD=""; DIM=""; RESET=""

  if [[ -t 1 && -z "$NO_COLOR" && "${TERM:-}" != "dumb" ]]; then
    # Terminal-default foreground plus restrained neutral/pastel accents.
    ROBOT=$'\033[38;5;248m'
    FACE=$'\033[39m'
    ACCENT=$'\033[38;5;141m'
    TIP=$'\033[38;5;173m'
    EYE=$'\033[38;5;147m'
    SUCCESS=$'\033[38;5;114m'
    WARNING=$'\033[38;5;179m'
    ERROR_COLOR=$'\033[38;5;203m'
    MUTED=$'\033[38;5;245m'
    BORDER=$'\033[38;5;245m'
    BOLD=$'\033[1m'
    DIM=$'\033[2m'
    RESET=$'\033[0m'
  fi

  if [[ -t 1 \
    && -z "$NO_COLOR" \
    && "${TERM:-}" != "dumb" \
    && -z "${PYTHINKER_NO_ANIMATION:-}" \
    && -z "${CI:-}" ]]; then
    _anim=1
  fi
}

_hide_cursor() {
  [[ -n "$_anim" ]] || return 0
  [[ -z "$_cursor_hidden" ]] || return 0
  printf '\033[?25l'
  _cursor_hidden=1
}

_show_cursor() {
  [[ -n "$_cursor_hidden" ]] || return 0
  printf '\033[?25h'
  _cursor_hidden=""
}

_cleanup() {
  if [[ -n "$DOWNLOAD_PID" ]] && kill -0 "$DOWNLOAD_PID" 2>/dev/null; then
    kill "$DOWNLOAD_PID" 2>/dev/null || true
    wait "$DOWNLOAD_PID" 2>/dev/null || true
  fi
  DOWNLOAD_PID=""

  _show_cursor || true

  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

fail() {
  _show_cursor || true
  if [[ -n "$_anim" ]]; then
    _clear_active_line
  fi
  printf '  %s✗%s %s\n' "$ERROR_COLOR" "$RESET" "$1" >&2
  exit 1
}

# The explicit width argument is optional; callers other than _wrap_text omit it
# and rely on detection.
# shellcheck disable=SC2120
_terminal_columns() {
  local explicit="${1:-}"
  local detected=""

  if [[ "$explicit" =~ ^[0-9]+$ ]] && (( explicit > 0 )); then
    printf '%s' "$explicit"
    return 0
  fi

  if [[ "${PYTHINKER_TERM_WIDTH:-}" =~ ^[0-9]+$ ]] \
    && (( PYTHINKER_TERM_WIDTH > 0 )); then
    printf '%s' "$PYTHINKER_TERM_WIDTH"
    return 0
  fi

  if [[ "${COLUMNS:-}" =~ ^[0-9]+$ ]] && (( COLUMNS > 0 )); then
    printf '%s' "$COLUMNS"
    return 0
  fi

  if [[ -t 1 && "${TERM:-}" != "dumb" ]] \
    && command -v tput >/dev/null 2>&1; then
    detected="$(tput cols 2>/dev/null || true)"
    if [[ "$detected" =~ ^[0-9]+$ ]] && (( detected > 0 )); then
      printf '%s' "$detected"
      return 0
    fi
  fi

  printf '80'
}

_progress_bar_width() {
  local columns="${1:-$(_terminal_columns)}"
  local width

  if (( columns >= 80 )); then
    width=44
  elif (( columns >= 55 )); then
    width=$((columns - 32))
    (( width > 44 )) && width=44
  else
    width=0
  fi

  printf '%s' "$width"
}

_repeat_char() {
  local char="$1" count="$2" result="" i
  for ((i=0; i<count; i++)); do
    result+="$char"
  done
  printf '%s' "$result"
}

_separator() {
  local columns width
  columns="$(_terminal_columns)"
  width=$((columns - 4))
  (( width > 50 )) && width=50
  (( width < 1 )) && width=1
  _repeat_char '─' "$width"
}

_format_bytes() {
  local bytes="${1:-0}"
  [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=0
  LC_ALL=C awk -v bytes="$bytes" 'BEGIN {
    if (bytes < 1024) {
      printf "%d B", bytes
    } else if (bytes < 1048576) {
      printf "%.1f KB", bytes / 1024
    } else if (bytes < 1073741824) {
      printf "%.1f MB", bytes / 1048576
    } else {
      printf "%.1f GB", bytes / 1073741824
    }
  }'
}

_format_byte_pair() {
  local current="${1:-0}" total="${2:-0}"
  [[ "$current" =~ ^[0-9]+$ ]] || current=0
  [[ "$total" =~ ^[0-9]+$ ]] || total=0
  LC_ALL=C awk -v current="$current" -v total="$total" 'BEGIN {
    unit = "B"; divisor = 1
    if (total >= 1073741824) {
      unit = "GB"; divisor = 1073741824
    } else if (total >= 1048576) {
      unit = "MB"; divisor = 1048576
    } else if (total >= 1024) {
      unit = "KB"; divisor = 1024
    }

    if (divisor == 1) {
      printf "%d/%d %s", current, total, unit
    } else {
      printf "%.1f/%.1f %s", current / divisor, total / divisor, unit
    }
  }'
}

_display_path() {
  local path="$1"
  if [[ -n "${HOME:-}" && "$path" == "$HOME" ]]; then
    printf '~'
  elif [[ -n "${HOME:-}" && "$path" == "$HOME/"* ]]; then
    printf '~%s' "${path#"$HOME"}"
  else
    printf '%s' "$path"
  fi
}

_current_file_size() {
  local file="$1"
  if [[ -f "$file" ]]; then
    wc -c < "$file" | tr -d '[:space:]'
  else
    printf '0'
  fi
}

_content_length() {
  local url="$1"
  command -v curl >/dev/null 2>&1 || return 1
  curl -fsIL "${CURL_META_OPTS[@]}" "$url" 2>/dev/null \
    | awk 'tolower($1) == "content-length:" {
        gsub("\r", "", $2)
        bytes = $2
      }
      END {
        if (bytes ~ /^[0-9]+$/) print bytes
      }'
}

_download_percent() {
  local output="$1" total="$2" size percent
  [[ "$total" =~ ^[0-9]+$ ]] && (( total > 0 )) || return 1
  size="$(_current_file_size "$output")"
  [[ "$size" =~ ^[0-9]+$ ]] || size=0
  percent=$((size * 100 / total))
  (( percent > 99 )) && percent=99
  (( percent < 0 )) && percent=0
  printf '%s' "$percent"
}

_clear_active_line() {
  [[ -n "$_anim" ]] || return 0
  printf '\r\033[2K'
}

_render_progress_determinate() {
  local percent="$1" current="$2" total="$3" frame="$4"
  local columns width filled empty filled_bar empty_bar pair

  [[ "$percent" =~ ^[0-9]+$ ]] || percent=0
  (( percent > 100 )) && percent=100
  (( percent < 0 )) && percent=0

  columns="$(_terminal_columns)"
  width="$(_progress_bar_width "$columns")"
  pair="$(_format_byte_pair "$current" "$total")"

  _clear_active_line

  if (( width == 0 )); then
    # Below 55 columns, keep the display percentage-only to avoid wrapping.
    printf '  %s%s%s Downloading  %3d%%' \
      "$ACCENT" "$frame" "$RESET" "$percent"
    return 0
  fi

  filled=$((percent * width / 100))
  empty=$((width - filled))
  filled_bar="$(_repeat_char '█' "$filled")"
  empty_bar="$(_repeat_char '░' "$empty")"

  printf '  %s%s%s Downloading  %s%s%s%s%s%s  %3d%%' \
    "$ACCENT" "$frame" "$RESET" \
    "$ACCENT" "$filled_bar" "$RESET" \
    "$BORDER" "$empty_bar" "$RESET" \
    "$percent"

  # At 80 columns the 44-cell bar fits, but byte details can wrap. Add them
  # only when there is enough room for the largest common value pair.
  if (( columns >= 88 )); then
    printf '  %s' "$pair"
  fi
}

_render_progress_indeterminate() {
  local frame="$1" current="$2"
  local columns received
  columns="$(_terminal_columns)"
  received="$(_format_bytes "$current")"
  _clear_active_line

  if (( columns < 45 )); then
    printf '  %s%s%s Downloading  %s' \
      "$ACCENT" "$frame" "$RESET" "$received"
  else
    printf '  %s%s%s Downloading  %sReceiving package…%s  %s' \
      "$ACCENT" "$frame" "$RESET" "$MUTED" "$RESET" "$received"
  fi
}

_render_waiting() {
  local frame="$1" delay="$2"
  local columns
  columns="$(_terminal_columns)"
  _clear_active_line

  if (( columns < 55 )); then
    printf '  %s%s%s Waiting; retry in %ss' \
      "$ACCENT" "$frame" "$RESET" "$delay"
  else
    printf '  %s%s%s Waiting      %sRelease assets are publishing; retry in %ss%s' \
      "$ACCENT" "$frame" "$RESET" "$MUTED" "$delay" "$RESET"
  fi
}

status_ok() {
  local label="$1" detail="${2:-}"
  printf '  %s✓%s %s' "$SUCCESS" "$RESET" "$label"
  if [[ -n "$detail" ]]; then
    printf '  %s%s%s' "$MUTED" "$detail" "$RESET"
  fi
  printf '\n'
}

status_warn() {
  local label="$1" detail="${2:-}"
  printf '  %s!%s %s' "$WARNING" "$RESET" "$label"
  if [[ -n "$detail" ]]; then
    printf '  %s%s%s' "$MUTED" "$detail" "$RESET"
  fi
  printf '\n'
}

print_logo_art() {
  printf '      %s●%s\n' "$TIP" "$RESET"
  printf '      %s│%s\n' "$ROBOT" "$RESET"
  printf '  %s▛%s%s▀▀▀▀▀▀▀%s%s▜%s\n' \
    "$ROBOT" "$RESET" "$FACE" "$RESET" "$ROBOT" "$RESET"
  printf ' %s◖%s%s█%s %s◉%s   %s◉%s %s█%s%s◗%s\n' \
    "$TIP" "$RESET" "$ROBOT" "$RESET" \
    "$EYE" "$RESET" "$EYE" "$RESET" \
    "$ROBOT" "$RESET" "$TIP" "$RESET"
  printf '  %s▙▄▄▄%s%s≡%s%s▄▄▄▟%s\n' \
    "$ROBOT" "$RESET" "$FACE" "$RESET" "$ROBOT" "$RESET"
}

_print_brand() {
  printf '\n  %s%sPYTHINKER CODE%s\n' "$BOLD" "$FACE" "$RESET"
  printf '  %sThink first. Then code.%s\n\n' "$MUTED" "$RESET"
}

print_logo_static() {
  printf '\n'
  print_logo_art
  _print_brand
}

print_logo_animated() {
  local delay="${PYTHINKER_LOGO_FRAME_DELAY:-0.07}"

  printf '\n'
  _hide_cursor

  # Each micro-animation rewrites only the line currently being composed.
  printf '      %s·%s' "$MUTED" "$RESET"
  sleep "$delay"
  _clear_active_line
  printf '      %s●%s\n' "$TIP" "$RESET"

  printf '      %s│%s\n' "$ROBOT" "$RESET"
  sleep "$delay"
  printf '  %s▛%s%s▀▀▀▀▀▀▀%s%s▜%s\n' \
    "$ROBOT" "$RESET" "$FACE" "$RESET" "$ROBOT" "$RESET"
  sleep "$delay"

  printf ' %s◖%s%s█%s %s·%s   %s·%s %s█%s%s◗%s' \
    "$TIP" "$RESET" "$ROBOT" "$RESET" \
    "$MUTED" "$RESET" "$MUTED" "$RESET" \
    "$ROBOT" "$RESET" "$TIP" "$RESET"
  sleep "$delay"
  _clear_active_line
  printf ' %s◖%s%s█%s %s◉%s   %s◉%s %s█%s%s◗%s\n' \
    "$TIP" "$RESET" "$ROBOT" "$RESET" \
    "$EYE" "$RESET" "$EYE" "$RESET" \
    "$ROBOT" "$RESET" "$TIP" "$RESET"

  printf '  %s▙▄▄▄%s%s≡%s%s▄▄▄▟%s\n' \
    "$ROBOT" "$RESET" "$FACE" "$RESET" "$ROBOT" "$RESET"
  sleep "$delay"

  printf '\n  %sPYTHINKER CODE%s' "$DIM" "$RESET"
  sleep "$delay"
  _clear_active_line
  printf '  %s%sPYTHINKER CODE%s\n' "$BOLD" "$FACE" "$RESET"
  printf '  %sThink first. Then code.%s\n\n' "$MUTED" "$RESET"

  _show_cursor
}

print_intro() {
  local destination
  destination="$(_display_path "$install_path")"

  if [[ -n "$_anim" ]]; then
    print_logo_animated
  else
    print_logo_static
  fi

  printf '  %s%-12s%s %s\n' "$MUTED" 'Version' "$RESET" "$VERSION"
  printf '  %s%-12s%s %s\n' "$MUTED" 'Platform' "$RESET" "$platform_display"
  printf '  %s%-12s%s %s\n' "$MUTED" 'Destination' "$RESET" "$destination"
  printf '\n'
}

print_done() {
  local sep destination
  sep="$(_separator)"
  destination="$(_display_path "$install_path")"

  printf '\n  %s%s%s\n\n' "$BORDER" "$sep" "$RESET"
  printf '  %s%sReady to think, plan, and build.%s\n\n' \
    "$BOLD" "$FACE" "$RESET"
  printf '  %sInstalled at%s  %s\n' "$MUTED" "$RESET" "$destination"
  printf '  %sStart with%s    %s%s$ pythinker%s\n\n' \
    "$MUTED" "$RESET" "$BOLD" "$ACCENT" "$RESET"
}

_fetch() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${CURL_META_OPTS[@]}" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "${WGET_META_OPTS[@]}" "$url"
  else
    return 127
  fi
}

_download_quiet() {
  local url="$1" output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${CURL_ARCHIVE_OPTS[@]}" "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "${WGET_ARCHIVE_OPTS[@]}" "$url" -O "$output"
  else
    return 127
  fi
}

_start_download() {
  local url="$1" output="$2"
  DOWNLOAD_PID=""

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${CURL_ARCHIVE_OPTS[@]}" "$url" -o "$output" &
  elif command -v wget >/dev/null 2>&1; then
    wget -q "${WGET_ARCHIVE_OPTS[@]}" "$url" -O "$output" &
  else
    return 127
  fi

  DOWNLOAD_PID=$!
}

# Machine-readable progress for the parent process. The background installer
# has no TTY, so stdout stays human-only (and is discarded by the spawn) and
# stderr carries the protocol: one newline-terminated line per update.
_emit_download_progress() {
  local percent="${1:-}" current="$2" total="$3"
  if [[ -n "$percent" ]]; then
    printf 'progress: state=downloading percent=%s transferred=%s total=%s\n' \
      "$percent" "$current" "$total" >&2
  else
    printf 'progress: state=downloading transferred=%s\n' "$current" >&2
  fi
}

# One download attempt with a live progress display. Returns non-zero on
# transport failure, an empty file, or a size short of Content-Length.
_download_attempt_with_progress() {
  local url="$1" output="$2"
  local total="" pid="" current=0 percent="" last_percent="-1" i=0 last_emit_i=-100 frame_index=0
  local -a frames=('◐' '◓' '◑' '◒')

  rm -f "$output"

  if [[ -z "$_anim" ]]; then
    # Background install: no TTY, so no ANSI. Poll the same way as the
    # animated branch, but report machine-readable lines on stderr instead of
    # rendering a bar. One line per second at most, and only when the integer
    # percent moved; the parent records these at most every 2s, so the
    # protocol stays far below the parent's throttle.
    if command -v curl >/dev/null 2>&1; then
      total="$(_content_length "$url" || true)"
    fi

    # `|| {...}` and not `if ! …`: after `if ! cmd`, `$?` inside the branch is
    # the negation's 0, so the real failure code would be reported as success.
    _start_download "$url" "$output" || {
      local start_rc=$?
      printf 'progress: state=failed\n' >&2
      return "$start_rc"
    }
    pid="$DOWNLOAD_PID"

    while kill -0 "$pid" 2>/dev/null; do
      current="$(_current_file_size "$output")"

      if [[ "$total" =~ ^[0-9]+$ ]] && (( total > 0 )); then
        percent="$(_download_percent "$output" "$total" || printf '0')"
      else
        percent=""
      fi

      # An unknown size has no percent to change, so it emits on the interval
      # alone — otherwise a wget-only host would show one line and then look
      # frozen for the whole download.
      if (( i - last_emit_i >= 9 )) && [[ -z "$percent" || "$percent" != "$last_percent" ]]; then
        _emit_download_progress "$percent" "$current" "$total"
        last_percent="$percent"
        last_emit_i="$i"
      fi

      sleep 0.12
      i=$((i + 1))
    done

    if ! wait "$pid"; then
      DOWNLOAD_PID=""
      printf 'progress: state=failed\n' >&2
      return 1
    fi
    DOWNLOAD_PID=""

    if ! _validate_download "$output" "$total"; then
      printf 'progress: state=failed\n' >&2
      return 1
    fi

    current="$(_current_file_size "$output")"
    printf 'progress: state=done transferred=%s\n' "$current" >&2
    status_ok 'Download complete' "$(_format_bytes "$current")"
    return 0
  fi

  if command -v curl >/dev/null 2>&1; then
    total="$(_content_length "$url" || true)"
  fi

  _start_download "$url" "$output" || return $?
  pid="$DOWNLOAD_PID"
  _hide_cursor

  while kill -0 "$pid" 2>/dev/null; do
    frame_index=$((i % 4))
    current="$(_current_file_size "$output")"

    if [[ "$total" =~ ^[0-9]+$ ]] && (( total > 0 )); then
      percent="$(_download_percent "$output" "$total" || printf '0')"
      _render_progress_determinate \
        "$percent" "$current" "$total" "${frames[$frame_index]}"
    else
      _render_progress_indeterminate "${frames[$frame_index]}" "$current"
    fi

    sleep 0.12
    i=$((i + 1))
  done

  if ! wait "$pid"; then
    DOWNLOAD_PID=""
    _show_cursor
    _clear_active_line
    return 1
  fi
  DOWNLOAD_PID=""

  if ! _validate_download "$output" "$total"; then
    _show_cursor
    _clear_active_line
    return 1
  fi

  current="$(_current_file_size "$output")"
  if [[ "$total" =~ ^[0-9]+$ ]] && (( total > 0 )); then
    _render_progress_determinate 100 "$current" "$total" '✓'
    printf '\n'
  else
    _clear_active_line
  fi

  _show_cursor
  status_ok 'Download complete' "$(_format_bytes "$current")"
}

# Reject empty downloads, and short downloads when Content-Length is known.
# A truncated archive would fail checksum verification anyway, but catching
# it here lets the retry loop recover instead of aborting the install.
_validate_download() {
  local output="$1" total="${2:-}"
  local size
  size="$(_current_file_size "$output")"
  [[ "$size" =~ ^[0-9]+$ ]] && (( size > 0 )) || return 1
  if [[ "$total" =~ ^[0-9]+$ ]] && (( total > 0 )) && (( size != total )); then
    return 1
  fi
  return 0
}

_download_with_progress() {
  local url="$1" output="$2"
  local attempt delay

  for attempt in 1 2 3; do
    if _download_attempt_with_progress "$url" "$output"; then
      return 0
    fi
    rm -f "$output"
    if (( attempt < 3 )); then
      delay=$((2 ** (attempt - 1)))
      status_warn 'Download failed' "retry $((attempt + 1))/3 in ${delay}s"
      sleep "$delay"
    fi
  done
  return 1
}

_download_quiet_with_retry() {
  local label="$1" url="$2" output="$3"
  local attempt delay

  for attempt in 1 2 3; do
    if _download_quiet "$url" "$output" && _validate_download "$output" ""; then
      return 0
    fi
    rm -f "$output"
    if (( attempt < 3 )); then
      delay=$((2 ** (attempt - 1)))
      status_warn "$label failed" "retry $((attempt + 1))/3 in ${delay}s"
      sleep "$delay"
    fi
  done
  return 1
}

_detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os/$arch" in
    Linux/x86_64|Linux/amd64)
      target='linux-x64'
      platform_display='Linux · x86_64'
      ;;
    Linux/aarch64|Linux/arm64)
      target='linux-arm64'
      platform_display='Linux · ARM64'
      ;;
    Darwin/arm64)
      target='darwin-arm64'
      platform_display='macOS · Apple Silicon'
      ;;
    Darwin/x86_64)
      target='darwin-x64'
      platform_display='macOS · Intel'
      ;;
    MINGW*/*|MSYS*/*|CYGWIN*/*)
      fail $'On Windows, use the PowerShell installer:\n  powershell -c "irm https://code.pythinker.com/pythinker-code/install.ps1 | iex"'
      ;;
    *)
      fail "unsupported target: $os/$arch"
      ;;
  esac
}

_resolve_version() {
  local api payload

  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 \
    || fail 'need curl or wget to fetch release metadata'

  if [[ -z "$VERSION" ]]; then
    VERSION="$(_fetch "$CDN_LATEST_URL" 2>/dev/null \
      | tr -d '[:space:]' || true)"

    if ! printf '%s' "$VERSION" \
      | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      api="https://api.github.com/repos/${REPO}/releases/latest"
      payload="$(_fetch "$api")" \
        || fail "could not reach $CDN_LATEST_URL or $api"
      VERSION="$(printf '%s' "$payload" \
        | sed -nE 's/.*"tag_name": *"@pythoughts\/pythinker-code@([0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' \
        | head -n 1)"
    fi
  fi

  printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
    || fail "invalid version '$VERSION'; expected X.Y.Z"
}

release_has_assets() {
  local api body
  api="https://api.github.com/repos/${REPO}/releases/tags/${tag_encoded}"
  body="$(_fetch "$api" 2>/dev/null)" || return 1
  printf '%s' "$body" | grep -Fq "\"${archive}\"" \
    && printf '%s' "$body" | grep -Fq "\"${archive}.sha256\""
}

_wait_for_release_assets() {
  local attempt=0 delay=4 elapsed=0 max_elapsed=360
  local -a frames=('◐' '◓' '◑' '◒')

  until release_has_assets; do
    if (( elapsed >= max_elapsed )); then
      fail "release assets for ${VERSION} are unavailable after about ${max_elapsed}s: ${archive_url}
The release may still be publishing. Try again shortly, or pin a known-good version with --version X.Y.Z"
    fi

    if [[ -n "$_anim" ]]; then
      _render_waiting "${frames[$((attempt % 4))]}" "$delay"
    else
      printf '  Waiting for release assets; retrying in %ss\n' "$delay"
      printf 'progress: state=waiting retry_in=%s elapsed=%s\n' "$delay" "$elapsed" >&2
    fi

    sleep "$delay"
    if [[ -n "$_anim" ]]; then
      _clear_active_line
    fi

    attempt=$((attempt + 1))
    elapsed=$((elapsed + delay))
    delay=$((delay * 2))
    (( delay > 120 )) && delay=120
  done

  if [[ -n "$_anim" ]] && (( attempt > 0 )); then
    _clear_active_line
  fi
}

_verify_checksum() {
  local checksum_file="$1" payload_file="$2"
  local expected actual

  expected="$(awk 'NR == 1 {print $1}' "$checksum_file" \
    | tr '[:upper:]' '[:lower:]')"
  printf '%s' "$expected" | grep -Eq '^[0-9a-f]{64}$' \
    || fail 'the release checksum file is malformed'

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$payload_file" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$payload_file" | awk '{print $1}')"
  else
    fail 'need sha256sum or shasum to verify the download'
  fi

  actual="$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')"
  [[ "$expected" == "$actual" ]] \
    || fail "SHA-256 mismatch: expected $expected, got $actual"

  status_ok 'Checksum verified'
}

_extract_and_install() {
  local payload="$TMP_DIR/pythinker"

  mkdir -p "$bin_dir"
  # Sweep staged leftovers from a previous interrupted run.
  rm -f "$install_path".tmp.* 2>/dev/null || true

  if command -v unzip >/dev/null 2>&1; then
    unzip -oq "$TMP_DIR/$archive" -d "$TMP_DIR"
  elif command -v tar >/dev/null 2>&1 \
    && tar -tf "$TMP_DIR/$archive" >/dev/null 2>&1; then
    tar -C "$TMP_DIR" -xf "$TMP_DIR/$archive"
  else
    fail "need unzip (or bsdtar) to extract $archive"
  fi

  [[ -f "$payload" ]] \
    || fail "archive did not contain a regular file named 'pythinker'"
  command -v install >/dev/null 2>&1 \
    || fail "need the 'install' command to place the executable"

  # Stage next to the target, then rename into place. `install` alone
  # truncate-writes the destination: overwriting a currently running
  # `pythinker` fails with ETXTBSY on Linux and can leave a half-written
  # binary on any platform. rename() replaces the path atomically and is
  # legal even while the old inode is still executing.
  local staged="$install_path.tmp.$$"
  if ! install -m 0755 "$payload" "$staged"; then
    rm -f "$staged"
    fail "could not stage the executable in $(_display_path "$bin_dir")"
  fi
  if ! mv -f "$staged" "$install_path"; then
    rm -f "$staged"
    fail "could not move the executable into place at $(_display_path "$install_path")"
  fi
  status_ok 'Installed successfully' "$(_display_path "$install_path")"
}

_print_path_guidance() {
  case ":$PATH:" in
    *":$bin_dir:"*)
      return 0
      ;;
  esac

  printf '\n'
  status_warn \
    'PATH update required' \
    "$(_display_path "$bin_dir") is not currently on PATH"
  printf '  %sBash or Zsh%s\n' "$MUTED" "$RESET"
  # $PATH stays literal on purpose — this line is shell config for the user to copy.
  # shellcheck disable=SC2016
  printf '    export PATH="%s:$PATH"\n' "$bin_dir"
  printf '  %sFish%s\n' "$MUTED" "$RESET"
  printf '    fish_add_path "%s"\n' "$bin_dir"
}

main() {
  local parse_status=0

  _parse_args "$@" || parse_status=$?
  if (( parse_status == 10 )); then
    return 0
  elif (( parse_status != 0 )); then
    return "$parse_status"
  fi

  _init_ui
  trap _cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  _detect_target
  _resolve_version

  tag_encoded="%40pythoughts%2Fpythinker-code%40${VERSION}"
  archive="pythinker-code-${target}.zip"
  archive_url="https://github.com/${REPO}/releases/download/${tag_encoded}/${archive}"
  sha_url="${archive_url}.sha256"
  bin_dir="$INSTALL_PREFIX/bin"
  install_path="$bin_dir/pythinker"

  print_intro
  _wait_for_release_assets

  TMP_DIR="$(mktemp -d -t pythinker-install.XXXXXX)"
  _download_with_progress "$archive_url" "$TMP_DIR/$archive" \
    || fail "download failed after 3 attempts: $archive_url"
  _download_quiet_with_retry 'Checksum download' "$sha_url" "$TMP_DIR/$archive.sha256" \
    || fail "checksum download failed after 3 attempts: $sha_url"

  _verify_checksum "$TMP_DIR/$archive.sha256" "$TMP_DIR/$archive"
  _extract_and_install
  _print_path_guidance
  print_done
}

# `curl … | bash` feeds the script over stdin, where BASH_SOURCE is empty and
# $0 is "bash". Defaulting to $0 keeps the piped install (the documented entry
# point) running main, still runs main when the file is executed directly, and
# still skips it when the script is sourced.
if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
  main "$@"
fi
