// SGR mouse reporting modes: button press/release (1000), drag motion while
// a button is held (1002), and SGR extended coordinates (1006). Wheel events
// arrive as button ids 64 (up) / 65 (down) under these modes.
export const MOUSE_REPORTING_ENABLE = '\u001B[?1000h\u001B[?1002h\u001B[?1006h';
export const MOUSE_REPORTING_DISABLE = '\u001B[?1006l\u001B[?1002l\u001B[?1000l';

// SGR mouse frame: ESC [ < button ; col ; row (M = press/motion, m = release).
// Columns and rows are 1-based screen coordinates.
export const MOUSE_SGR_PATTERN = /^\u001B\[<(\d+);(\d+);(\d+)([Mm])$/u;

// Transcript lines scrolled per wheel notch.
export const MOUSE_SCROLL_LINES = 3;

// Repeat cadence while a drag selection rests on a transcript edge.
export const MOUSE_DRAG_SCROLL_INTERVAL_MS = 80;

export const OSC52_CLIPBOARD_PREFIX = '\u001B]52;c;';
export const OSC52_CLIPBOARD_SUFFIX = '\u0007';
