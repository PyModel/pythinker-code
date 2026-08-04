// Safety cap for counted `o`/`O` open-line commands: each opened line is
// allocated in the Vim buffer, so unbounded counts could exhaust memory.
export const VIM_OPEN_LINE_COUNT_CAP = 10_000;
