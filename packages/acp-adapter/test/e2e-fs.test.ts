/**
 * End-to-end test for the FS reverse-RPC bridge.
 *
 * Wire shape under test:
 *
 *   ┌────────┐  fs/readTextFile (RPC)   ┌────────┐
 *   │ client │ ───────────────────────► │ agent  │
 *   │        │                          │ │      │
 *   │        │ ◄──── { content: ... } ──│ ▼ tool │
 *   └────────┘                          │ uses   │
 *                                       │ pyaos   │
 *                                       └────────┘
 *
 * Boundary-injection model: when the client advertises
 * `clientCapabilities.fs.readTextFile`, `AcpServer.newSession` builds
 * an {@link AcpPyaos} and threads it into `harness.createSession({ pyaos })`.
 * In the real stack the kernel `SessionImpl` ctor captures that pyaos
 * and every tool (Read / Write / Edit / Grep / Glob / Bash) sees the
 * same reference. The harness stub here mimics that capture by
 * forwarding the supplied pyaos into the fake Session's `prompt` body —
 * exactly what a real Read tool would consult.
 */

import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type ContentBlock,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { Pyaos } from '@pymodel/pyaos';
import type { Event, PythinkerHarness, Session } from '@pymodel/pythinker-code-sdk';
import { describe, expect, it } from 'vitest';

import { AcpServer } from '../src/server';
import { AUTHED_STATUS } from './_helpers/harness-stubs';

function makeInMemoryStreamPair(): {
  agentStream: ReturnType<typeof ndJsonStream>;
  clientStream: ReturnType<typeof ndJsonStream>;
} {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const agentStream = ndJsonStream(agentToClient.writable, clientToAgent.readable);
  const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable);
  return { agentStream, clientStream };
}

class UnsavedBufferClient implements Client {
  readonly readRequests: ReadTextFileRequest[] = [];
  readonly updates: SessionNotification[] = [];
  unsavedContent = 'UNSAVED BUFFER CONTENT';

  async readTextFile(p: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    this.readRequests.push(p);
    return { content: this.unsavedContent };
  }
  async writeTextFile(_p: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error('writeTextFile not exercised in this e2e test');
  }
  async sessionUpdate(n: SessionNotification): Promise<void> {
    this.updates.push(n);
  }
  async requestPermission(_p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    throw new Error('requestPermission not exercised in this e2e test');
  }
}

/**
 * Build a fake `Session` whose `prompt` calls `pyaos.readText(targetPath)`
 * — what a real Read tool would do — and emits the contents as an
 * assistant delta. The pyaos is supplied at construction time (mirroring
 * the kernel `SessionImpl` ctor's capture-on-construction behavior).
 */
function makeReadingSession(
  sessionId: string,
  targetPath: string,
  pyaos: Pyaos | undefined,
): Session {
  const listeners = new Set<(event: Event) => void>();
  return {
    id: sessionId,
    prompt: async (_input: unknown) => {
      if (pyaos === undefined) {
        throw new Error('pyaos missing — boundary injection failed');
      }
      const content = await pyaos.readText(targetPath);

      for (const fn of listeners) {
        fn({
          type: 'assistant.delta',
          sessionId,
          agentId: 'main',
          turnId: 1,
          delta: content,
        } as Event);
      }
      for (const fn of listeners) {
        fn({
          type: 'turn.ended',
          sessionId,
          agentId: 'main',
          turnId: 1,
          reason: 'completed',
        } as Event);
      }
    },
    cancel: async () => undefined,
    onEvent: (fn: (event: Event) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  } as unknown as Session;
}

const textBlock = (text: string): ContentBlock => ({ type: 'text', text });

describe('end-to-end FS reverse-RPC', () => {
  it('routes a tool-time readText through the client when fs.readTextFile is advertised', async () => {
    const targetPath = '/Users/test/x.ts';
    let createdSession: Session | undefined;
    let capturedSessionId: string | undefined;
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async (options: { id?: string; workDir: string; pyaos?: Pyaos }) => {
        capturedSessionId = options.id ?? 'fallback';
        createdSession = makeReadingSession(capturedSessionId, targetPath, options.pyaos);
        return createdSession;
      },
    } as unknown as PythinkerHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const bufferClient = new UnsavedBufferClient();
    const client = new ClientSideConnection(() => bufferClient, clientStream);

    // Initialize with the FS read capability advertised — this is the
    // wire signal that switches the agent to `AcpPyaos`.
    await client.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
    });

    const newSession = await client.newSession({ cwd: '/tmp/x', mcpServers: [] });

    const response = await client.prompt({
      sessionId: newSession.sessionId,
      prompt: [textBlock('read the unsaved file please')],
    });

    expect(response.stopReason).toBe('end_turn');

    // The client saw exactly one fs/readTextFile request with the
    // expected path and matching sessionId.
    expect(bufferClient.readRequests).toHaveLength(1);

    // AcpPyaos forwards paths in client-native separators: when the inner
    // LocalPyaos reports pathClass 'win32' (Windows), '/' is converted to '\\'
    // before the fs/readTextFile RPC (see pyaos-acp.test.ts "uses win32-native
    // separators"). Mirror that here so the assertion holds on every platform.
    const expectedWirePath =
      process.platform === 'win32' ? targetPath.replaceAll('/', '\\') : targetPath;
    expect(bufferClient.readRequests[0]).toMatchObject({
      sessionId: capturedSessionId,
      path: expectedWirePath,
    });

    // Give the agent a tick to flush the queued sessionUpdate write
    // through the ndjson stream.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const chunkUpdate = bufferClient.updates.find(
      (u) => u.update.sessionUpdate === 'agent_message_chunk',
    );
    expect(chunkUpdate).toBeDefined();
    expect(chunkUpdate?.update).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'UNSAVED BUFFER CONTENT' },
    });
  });

  it('does NOT route through the client when no FS capability is advertised', async () => {
    let observedPyaos: Pyaos | undefined;
    let capturedSessionId: string | undefined;

    const listeners = new Set<(event: Event) => void>();
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async (options: { id?: string; workDir: string; pyaos?: Pyaos }) => {
        observedPyaos = options.pyaos;
        capturedSessionId = options.id ?? 'fallback';
        return {
          id: capturedSessionId,
          prompt: async () => {
            for (const fn of listeners) {
              fn({
                type: 'turn.ended',
                sessionId: capturedSessionId,
                agentId: 'main',
                turnId: 1,
                reason: 'completed',
              } as Event);
            }
          },
          cancel: async () => undefined,
          onEvent: (fn: (event: Event) => void) => {
            listeners.add(fn);
            return () => {
              listeners.delete(fn);
            };
          },
        } as unknown as Session;
      },
    } as unknown as PythinkerHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const bufferClient = new UnsavedBufferClient();
    const client = new ClientSideConnection(() => bufferClient, clientStream);

    await client.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });

    const newSession = await client.newSession({ cwd: '/tmp/x', mcpServers: [] });

    const response = await client.prompt({
      sessionId: newSession.sessionId,
      prompt: [textBlock('hi')],
    });

    expect(response.stopReason).toBe('end_turn');
    expect(bufferClient.readRequests).toEqual([]);
    expect(observedPyaos).toBeUndefined();
  });
});
