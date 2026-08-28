import { z } from 'zod';

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export const authSummarySchema = z.object({
  ready: z.boolean(),
  models_ready: z.boolean(),
  providers_count: z.number().int().nonnegative(),
  default_model: z.string().nullable(),
});
export type AuthSummary = z.infer<typeof authSummarySchema>;

export interface IAuthStatusService {
  readonly _serviceBrand: undefined;

  get(): Promise<AuthSummary>;
}

export const IAuthStatusService: ServiceIdentifier<IAuthStatusService> =
  createDecorator<IAuthStatusService>('authStatusService');
