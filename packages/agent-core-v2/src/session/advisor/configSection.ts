import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const ADVISOR_SECTION = 'advisor';

export const AdvisorConfigSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().trim().min(1).optional(),
  instructions: z.string().max(10_000).optional(),
}).superRefine((value, context) => {
  if (value.enabled === true && value.model === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['model'],
      message: '[advisor].model is required when [advisor].enabled is true',
    });
  }
});

export type AdvisorConfig = z.infer<typeof AdvisorConfigSchema>;

registerConfigSection(ADVISOR_SECTION, AdvisorConfigSchema, {
  defaultValue: { enabled: false },
});
