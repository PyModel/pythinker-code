import { z } from 'zod';

import { getUpdateInstallStateFile } from '#/utils/paths';
import { readJsonFile, writeJsonFile } from '#/utils/persistence';

import { emptyUpdateInstallState, type InstallSource, type UpdateInstallProgress, type UpdateInstallState } from './types';

const InstallSourceSchema: z.ZodType<InstallSource> = z.enum([
  'npm-global',
  'pnpm-global',
  'yarn-global',
  'bun-global',
  'homebrew',
  'native',
  'unsupported',
]);

const UpdateInstallOperationSchema = z.enum(['install', 'prepare', 'activate']);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const UpdateInstallProgressSchema: z.ZodType<UpdateInstallProgress> = z
  .object({
    state: z.enum(['downloading', 'waiting', 'done', 'failed']),
    percent: z.number().int().min(0).max(100).optional(),
    transferred: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    updatedAt: z.string().min(1),
  })
  .strict();

const UpdateInstallStateSchema: z.ZodType<UpdateInstallState> = z
  .object({
    active: z
      .object({
        version: z.string().min(1),
        source: InstallSourceSchema,
        startedAt: z.string().min(1),
        pid: z.number().int().positive().optional(),
        operation: UpdateInstallOperationSchema.optional(),
        jobId: z.uuid().optional(),
        progress: UpdateInstallProgressSchema.optional(),
      })
      .strict()
      .nullable(),
    pending: z
      .object({
        jobId: z.uuid(),
        source: z.literal('homebrew'),
        version: z.string().min(1),
        preparedAt: z.string().min(1),
        requestedBy: z.enum(['automatic', 'manual']),
        formulaUrl: z.url(),
        artifactKind: z.literal('source'),
        artifactSha256: Sha256Schema,
        formulaFileSha256: Sha256Schema,
        artifactPath: z.string().min(1),
      })
      .strict()
      .nullable()
      .default(null),
    lastFailure: z
      .object({
        version: z.string().min(1),
        failedAt: z.string().min(1),
        attempts: z.number().int().min(1),
        operation: UpdateInstallOperationSchema.optional(),
        message: z.string().min(1).optional(),
      })
      .strict()
      .nullable(),
    lastSuccess: z
      .object({
        version: z.string().min(1),
        installedAt: z.string().min(1),
        notifiedAt: z.string().min(1).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export { emptyUpdateInstallState };

export async function readUpdateInstallState(
  filePath: string = getUpdateInstallStateFile(),
): Promise<UpdateInstallState> {
  try {
    return await readJsonFile(filePath, UpdateInstallStateSchema, emptyUpdateInstallState());
  } catch {
    return emptyUpdateInstallState();
  }
}

export async function writeUpdateInstallState(
  value: UpdateInstallState,
  filePath: string = getUpdateInstallStateFile(),
): Promise<void> {
  await writeJsonFile(filePath, UpdateInstallStateSchema, value, { durable: true });
}
