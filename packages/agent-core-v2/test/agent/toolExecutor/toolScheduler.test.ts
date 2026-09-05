import { describe, expect, it } from 'vitest';

import { ToolAccesses } from '#/tool/toolContract';
import { ToolScheduler, type ToolCallTask } from '#/agent/toolExecutor/toolScheduler';

describe('ToolScheduler', () => {
  it('starts read accesses on the same path concurrently', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const first = makeControlledTask('first', readPath('/repo/a.ts'), started);
    const second = makeControlledTask('second', readPath('/repo/a.ts'), started);

    scheduler.add(first.task);
    scheduler.add(second.task);

    expect(started).toEqual(['first', 'second']);
    second.resolve();
    first.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['first', 'second']);
  });

  it('waits when read and write accesses intersect', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const writer = makeControlledTask('writer', writePath('/repo/a.ts'), started);
    const reader = makeControlledTask('reader', readPath('/repo/a.ts'), started);

    scheduler.add(writer.task);
    scheduler.add(reader.task);
    await waitOneMacrotask();

    expect(started).toEqual(['writer']);
    writer.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['writer', 'reader']);

    reader.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['writer', 'reader']);
  });

  it('serializes write accesses on the same path', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const firstWriter = makeControlledTask('first-writer', writePath('/repo/a.ts'), started);
    const secondWriter = makeControlledTask('second-writer', writePath('/repo/a.ts'), started);

    scheduler.add(firstWriter.task);
    scheduler.add(secondWriter.task);
    await waitOneMacrotask();

    expect(started).toEqual(['first-writer']);
    firstWriter.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['first-writer', 'second-writer']);

    secondWriter.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['first-writer', 'second-writer']);
  });

  it('serializes path accesses that differ only by case', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const writer = makeControlledTask('writer', writePath('C:\\Repo\\a.ts'), started);
    const reader = makeControlledTask('reader', readPath('c:/repo/A.ts'), started);

    scheduler.add(writer.task);
    scheduler.add(reader.task);
    await waitOneMacrotask();

    expect(started).toEqual(['writer']);
    writer.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['writer', 'reader']);

    reader.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['writer', 'reader']);
  });

  it('does not block non-intersecting path accesses', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const writer = makeControlledTask('writer', writePath('/repo/a.ts'), started);
    const reader = makeControlledTask('reader', readPath('/repo/b.ts'), started);

    scheduler.add(writer.task);
    scheduler.add(reader.task);

    expect(started).toEqual(['writer', 'reader']);
    reader.resolve();
    writer.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['writer', 'reader']);
  });

  it('treats recursive path accesses as covering descendants', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const treeReader = makeControlledTask('tree-reader', readTree('/repo/src'), started);
    const childWriter = makeControlledTask('child-writer', writePath('/repo/src/a.ts'), started);

    scheduler.add(treeReader.task);
    scheduler.add(childWriter.task);
    await waitOneMacrotask();

    expect(started).toEqual(['tree-reader']);
    treeReader.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['tree-reader', 'child-writer']);

    childWriter.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['tree-reader', 'child-writer']);
  });

  it('releases conflicting accesses when a task result rejects', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const writer = makeControlledTask('writer', writePath('/repo/a.ts'), started);
    const reader = makeControlledTask('reader', readPath('/repo/a.ts'), started);

    scheduler.add(writer.task);
    scheduler.add(reader.task);
    await waitOneMacrotask();

    expect(started).toEqual(['writer']);
    writer.reject(new Error('boom'));
    await waitOneMacrotask();
    expect(started).toEqual(['writer', 'reader']);

    reader.resolve();
    await scheduler.allSettled();
  });

  it('starts later independent accesses while an earlier task is queued', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const firstWriter = makeControlledTask('first-writer', writePath('/repo/a.ts'), started);
    const secondWriter = makeControlledTask('second-writer', writePath('/repo/a.ts'), started);
    const reader = makeControlledTask('reader', readPath('/repo/b.ts'), started);

    scheduler.add(firstWriter.task);
    scheduler.add(secondWriter.task);
    scheduler.add(reader.task);
    await waitOneMacrotask();

    expect(started).toEqual(['first-writer', 'reader']);

    reader.resolve();
    firstWriter.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['first-writer', 'reader', 'second-writer']);

    secondWriter.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['first-writer', 'second-writer', 'reader']);
  });

  it('does not start later tasks that conflict with queued accesses', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const writer = makeControlledTask('writer', writePath('/repo/a.ts'), started);
    const exclusive = makeControlledTask('exclusive', ToolAccesses.all(), started);
    const reader = makeControlledTask('reader', readPath('/repo/b.ts'), started);

    scheduler.add(writer.task);
    scheduler.add(exclusive.task);
    scheduler.add(reader.task);
    await waitOneMacrotask();

    expect(started).toEqual(['writer']);

    writer.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['writer', 'exclusive']);

    exclusive.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['writer', 'exclusive', 'reader']);

    reader.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['writer', 'exclusive', 'reader']);
  });

  it('serializes all-resource access against file access', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const reader = makeControlledTask('reader', readPath('/repo/a.ts'), started);
    const exclusive = makeControlledTask('exclusive', ToolAccesses.all(), started);

    scheduler.add(reader.task);
    scheduler.add(exclusive.task);
    await waitOneMacrotask();

    expect(started).toEqual(['reader']);
    reader.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['reader', 'exclusive']);

    exclusive.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['reader', 'exclusive']);
  });

  it('dispatches submitted results in provider order', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    const first = makeControlledTask('first', ToolAccesses.none(), started);
    const second = makeControlledTask('second', ToolAccesses.none(), started);

    scheduler.add(first.task);
    scheduler.add(second.task);
    second.resolve();
    first.resolve();
    await scheduler.collectResults();

    expect(drained).toEqual(['first', 'second']);
  });
});

interface ControlledTask {
  readonly task: ToolCallTask<string>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

describe('ToolScheduler leases and budgets', () => {
  it('keeps a conflicting task queued until the abandoned effect settles', async () => {
    const started: string[] = [];
    const drained: string[] = [];
    const scheduler = makeScheduler(drained);
    let settleEffects: () => void = () => {};
    const effectsSettled = new Promise<void>((resolve) => {
      settleEffects = resolve;
    });
    const abandoned = makeControlledTask('abandoned', writePath('/repo/a.ts'), started, effectsSettled);
    const follower = makeControlledTask('follower', writePath('/repo/a.ts'), started);

    scheduler.add(abandoned.task);
    scheduler.add(follower.task);
    abandoned.resolve();
    await waitOneMacrotask();

    expect(started).toEqual(['abandoned']);
    settleEffects();
    await waitOneMacrotask();
    expect(started).toEqual(['abandoned', 'follower']);
    follower.resolve();
    await scheduler.collectResults();
    expect(drained).toEqual(['abandoned', 'follower']);
  });

  it('blocks on outstanding effects from a previous scheduler', async () => {
    const started: string[] = [];
    let settleEffects: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      settleEffects = resolve;
    });
    const scheduler = new ToolScheduler<string>([{ accesses: writePath('/repo/a.ts'), settled }]);
    const conflicting = makeControlledTask('conflicting', readPath('/repo/a.ts'), started);
    const unrelated = makeControlledTask('unrelated', readPath('/repo/b.ts'), started);
    const results = [scheduler.add(conflicting.task), scheduler.add(unrelated.task)];
    await waitOneMacrotask();

    expect(started).toEqual(['unrelated']);
    settleEffects();
    await waitOneMacrotask();
    expect(started).toEqual(['unrelated', 'conflicting']);
    conflicting.resolve();
    unrelated.resolve();
    await Promise.all(results);
  });

  it('caps unrelated concurrency at the configured budget', async () => {
    const started: string[] = [];
    const scheduler = new ToolScheduler<string>([], 2);
    const tasks = ['a', 'b', 'c', 'd'].map((name) =>
      makeControlledTask(name, readPath(`/repo/${name}.ts`), started),
    );
    const results = tasks.map((task) => scheduler.add(task.task));
    await waitOneMacrotask();

    expect(started).toEqual(['a', 'b']);
    expect(scheduler.running).toBe(2);
    tasks[0]!.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['a', 'b', 'c']);
    tasks[1]!.resolve();
    tasks[2]!.resolve();
    await waitOneMacrotask();
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    tasks[3]!.resolve();
    await Promise.all(results);
    await waitOneMacrotask();
    expect(scheduler.running).toBe(0);
  });
});

function makeScheduler(drained: string[]): {
  readonly add: (task: ToolCallTask<string>) => void;
  readonly collectResults: () => Promise<void>;
  readonly allSettled: () => Promise<void>;
} {
  const scheduler = new ToolScheduler<string>();
  const results: Array<Promise<string>> = [];
  return {
    add: (task) => {
      results.push(scheduler.add(task));
    },
    collectResults: async () => {
      for (const task of results) {
        drained.push(await task);
      }
    },
    allSettled: async () => {
      await Promise.allSettled(results);
    },
  };
}

function makeControlledTask(
  name: string,
  accesses: ToolAccesses,
  startedNames: string[],
  effectsSettled?: Promise<unknown>,
): ControlledTask {
  let resolveResult: (value: string) => void = () => {};
  let rejectResult: (error: unknown) => void = () => {};
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  return {
    task: {
      accesses,
      start: async () => {
        startedNames.push(name);
        return { result, effectsSettled };
      },
    },
    resolve: () => {
      resolveResult(name);
    },
    reject: (error) => {
      rejectResult(error);
    },
  };
}

function readPath(path: string): ToolAccesses {
  return ToolAccesses.readFile(path);
}

function readTree(path: string): ToolAccesses {
  return ToolAccesses.readTree(path);
}

function writePath(path: string): ToolAccesses {
  return ToolAccesses.writeFile(path);
}

async function waitOneMacrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
