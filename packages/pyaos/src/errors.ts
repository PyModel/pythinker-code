/**
 * Base error class for the pyaos package.
 */
export class PyaosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PyaosError';
  }
}

/**
 * Equivalent to Python's ValueError — indicates an invalid argument was passed.
 */
export class PyaosValueError extends PyaosError {
  constructor(message: string) {
    super(message);
    this.name = 'PyaosValueError';
  }
}

/**
 * Equivalent to Python's FileExistsError — indicates a file or directory already exists.
 */
export class PyaosFileExistsError extends PyaosError {
  constructor(message: string) {
    super(message);
    this.name = 'PyaosFileExistsError';
  }
}

/**
 * Thrown by `detectEnvironment` on Windows when no Git Bash install can be
 * located. Carries the list of paths that were probed so callers can include
 * them in install hints.
 */
export class PyaosShellNotFoundError extends PyaosError {
  constructor(message: string) {
    super(message);
    this.name = 'PyaosShellNotFoundError';
  }
}
