import { beforeEach } from 'vitest';

import { setCurrentPyaos } from '#/current';
import { LocalPyaos } from '#/local';

const pyaos = await LocalPyaos.create();

// Bind synchronously in `beforeEach`. `enterWith` mutates the running async
// context; vitest's test body is awaited next from the same chain, so it
// inherits the binding. An `await` inside `beforeEach` would push the bind
// into a child context that the test body wouldn't see.
beforeEach(() => {
  setCurrentPyaos(pyaos);
});
