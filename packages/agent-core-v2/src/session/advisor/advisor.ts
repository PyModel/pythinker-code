import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export interface ISessionAdvisorService {
  readonly _serviceBrand: undefined;
}

export const ISessionAdvisorService: ServiceIdentifier<ISessionAdvisorService> =
  createDecorator<ISessionAdvisorService>('sessionAdvisorService');
