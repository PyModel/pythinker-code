export async function collectCodebase(
  _root?: string,
): Promise<{ files: readonly string[] }> {
  return { files: [] };
}

export async function packageCodebase(
  _input?: unknown,
): Promise<{ path: string } | null> {
  return null;
}

export async function scanCodebase(
  _root?: string,
): Promise<{ fileCount: number }> {
  return { fileCount: 0 };
}
