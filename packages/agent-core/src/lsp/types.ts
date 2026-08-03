import { z } from 'zod';

const FileExtensionSchema = z
  .string()
  .regex(/^\.[A-Za-z0-9][A-Za-z0-9.+_-]*$/u, 'file extensions must start with "."');

export const LspServerConfigSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string().min(1)).optional(),
    extensionToLanguage: z
      .record(FileExtensionSchema, z.string().min(1))
      .refine((value) => Object.keys(value).length > 0, {
        message: 'extensionToLanguage must contain at least one mapping',
      }),
    transport: z.literal('stdio').optional(),
    env: z.record(z.string(), z.string()).optional(),
    initializationOptions: z.unknown().optional(),
    settings: z.unknown().optional(),
    workspaceFolder: z.string().optional(),
    startupTimeout: z.number().int().positive().optional(),
    shutdownTimeout: z.number().int().positive().optional(),
    restartOnCrash: z.boolean().optional(),
    maxRestarts: z.number().int().nonnegative().optional(),
  })
  .strict();

export type LspServerConfig = z.infer<typeof LspServerConfigSchema>;
export type LspServerConfigs = Readonly<Record<string, LspServerConfig>>;
