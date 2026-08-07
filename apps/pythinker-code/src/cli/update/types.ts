import { NPM_PACKAGE_NAME } from '#/constant/app';

export { NPM_PACKAGE_NAME };

/** Where the running CLI was installed from. Drives update command + spawn. */
export type InstallSource =
  | 'npm-global'
  | 'pnpm-global'
  | 'yarn-global'
  | 'bun-global'
  | 'homebrew'
  | 'native'
  | 'unsupported';

export interface UpdateTarget {
  readonly version: string;
}

/** One gradual-rollout cohort: `percent` of devices delayed by `delaySeconds`. */
export interface RolloutBatch {
  readonly percent: number;
  readonly delaySeconds: number;
}

export interface UpdateManifestPlatform {
  readonly url: string;
  readonly sha256: string;
}

/**
 * Parsed CDN `latest.json`. `rollout` batches claim bucket ranges in array
 * order; an empty array means the release is fully rolled out immediately.
 */
export interface UpdateManifest {
  readonly version: string;
  readonly publishedAt: string;
  readonly rollout: readonly RolloutBatch[];
  /**
   * Resolved per-platform artifacts, keyed `<platform>-<arch>`. Absent on
   * manifests published before artifact addressing shipped.
   */
  readonly platforms?: Readonly<Record<string, UpdateManifestPlatform>>;
}

export interface UpdateCache {
  readonly source: 'cdn';
  readonly checkedAt: string | null;
  readonly latest: string | null;
  /** Null when the manifest came from the plain-text fallback or a legacy cache file. */
  readonly manifest: UpdateManifest | null;
}

export type UpdateInstallOperation = 'install' | 'prepare' | 'activate';
export type UpdateRequestOrigin = 'automatic' | 'manual';

/**
 * Latest machine-readable progress line from the background installer's
 * stderr, as recorded on the active install record.
 */
export interface UpdateInstallProgress {
  readonly state: 'downloading' | 'waiting' | 'done' | 'failed';
  /** Integer 0..100; absent while the download size is unknown. */
  readonly percent?: number;
  readonly transferred?: number;
  readonly total?: number;
  readonly updatedAt: string;
}

export interface UpdateInstallActive {
  readonly version: string;
  readonly source: InstallSource;
  /** Installer process id; absent in records persisted by older versions. */
  readonly startedAt: string;
  readonly pid?: number;
  readonly operation?: UpdateInstallOperation;
  readonly jobId?: string;
  /**
   * Latest progress line from the installer; absent until the installer
   * emits one or in records persisted by older versions.
   */
  readonly progress?: UpdateInstallProgress;
}

export interface UpdatePreparedHomebrew {
  readonly jobId: string;
  readonly source: 'homebrew';
  readonly version: string;
  readonly preparedAt: string;
  readonly requestedBy: UpdateRequestOrigin;
  readonly formulaUrl: string;
  readonly artifactKind: 'source';
  readonly artifactSha256: string;
  readonly formulaFileSha256: string;
  readonly artifactPath: string;
}

export interface UpdateInstallFailure {
  readonly version: string;
  readonly failedAt: string;
  readonly attempts: number;
  readonly operation?: UpdateInstallOperation;
  readonly message?: string;
}

export interface UpdateInstallSuccess {
  readonly version: string;
  readonly installedAt: string;
  readonly notifiedAt: string | null;
}

export interface UpdateInstallState {
  readonly active: UpdateInstallActive | null;
  readonly pending: UpdatePreparedHomebrew | null;
  readonly lastFailure: UpdateInstallFailure | null;
  readonly lastSuccess: UpdateInstallSuccess | null;
}

export type UpdateDecision = 'none' | 'prompt-install' | 'manual-command';
export type UpdatePreflightResult = 'continue' | 'exit';

export function emptyUpdateCache(): UpdateCache {
  return {
    source: 'cdn',
    checkedAt: null,
    latest: null,
    manifest: null,
  };
}

export function emptyUpdateInstallState(): UpdateInstallState {
  return {
    active: null,
    pending: null,
    lastFailure: null,
    lastSuccess: null,
  };
}
