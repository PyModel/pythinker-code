/**
 * `@pymodel/kap-server` public surface — the Pythinker Code server backed by the
 * DI × Scope agent engine (`@pymodel/agent-core-v2`).
 */

export { startServer } from './start';
export type { ServerHostIdentity, ServerStartOptions, RunningServer } from './start';
export { okEnvelope, errEnvelope } from './envelope';
export type { Envelope } from './envelope';
export { classify } from './security/bindClassify';
export type { BindClass } from './security/bindClassify';
export { rotateServerToken, serverTokenPath } from './services/auth/persistentToken';
export { createServerLogger } from './services/pinoLoggerService';
export type {
  CreateLoggerOptions,
  ServerLogger,
  ServerLogLevel,
} from './services/pinoLoggerService';
export {
  createInstanceRegistry,
  listLiveServerInstances,
  getLiveServerInstance,
  resolveServerInstancesDir,
  DEFAULT_SERVER_DIR,
  DEFAULT_SERVER_INSTANCES_DIR,
  HEARTBEAT_INTERVAL_MS,
} from './instanceRegistry';
export type {
  IInstanceRegistry,
  InstanceRegistration,
  InstanceRegistryOptions,
  ServerInstanceInfo,
} from './instanceRegistry';
