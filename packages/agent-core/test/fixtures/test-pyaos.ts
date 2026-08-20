import { LocalPyaos, type Environment } from '@pymodel/pyaos';

export const TEST_OS_ENV: Environment = {
  osKind: 'Linux',
  osArch: 'x86_64',
  osVersion: 'test',
  shellName: 'bash',
  shellPath: '/bin/bash',
};

// `LocalPyaos`'s constructor is `private` at the TS level only — at runtime
// it's just a function. Skip the singleton/async detection path and build a
// fresh instance with a stub `osEnv` so test helpers can hand a real Pyaos
// directly to `RuntimeConfig`.
type LocalPyaosCtor = new (osEnv: Environment) => LocalPyaos;
export const testPyaos: LocalPyaos = new (LocalPyaos as unknown as LocalPyaosCtor)(TEST_OS_ENV);
