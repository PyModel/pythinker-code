/** Shared failure-message formatter for update install/prepare/activate state. */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
