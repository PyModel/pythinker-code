import { describe, expect, it } from 'vitest';

import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type InitializeRequest,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { PythinkerHarness } from '@pymodel/pythinker-code-sdk';

import { AcpServer } from '../src/server';

class StubClient implements Client {
  async requestPermission(_params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    throw new Error('requestPermission should not be called');
  }

  async sessionUpdate(_notification: SessionNotification): Promise<void> {
    throw new Error('sessionUpdate should not be called');
  }

  async writeTextFile(_params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error('writeTextFile should not be called');
  }

  async readTextFile(_params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    throw new Error('readTextFile should not be called');
  }
}

function makeInMemoryStreamPair(): {
  agentStream: ReturnType<typeof ndJsonStream>;
  clientStream: ReturnType<typeof ndJsonStream>;
} {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  return {
    agentStream: ndJsonStream(agentToClient.writable, clientToAgent.readable),
    clientStream: ndJsonStream(clientToAgent.writable, agentToClient.readable),
  };
}

async function initialize(
  options: ConstructorParameters<typeof AcpServer>[2] = {},
  protocolVersion = 1,
) {
  const { agentStream, clientStream } = makeInMemoryStreamPair();
  new AgentSideConnection(
    (connection) => new AcpServer({} as PythinkerHarness, connection, options),
    agentStream,
  );
  const client = new ClientSideConnection(() => new StubClient(), clientStream);
  const request: InitializeRequest = {
    protocolVersion,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
  };
  return client.initialize(request);
}

describe('AcpServer initialize', () => {
  it('advertises protocol capabilities without an interactive auth method', async () => {
    const response = await initialize();

    expect(response.protocolVersion).toBe(1);
    expect(response.authMethods).toEqual([]);
    expect(response.agentCapabilities?.loadSession).toBe(true);
    expect(response.agentCapabilities?.promptCapabilities).toEqual({
      image: true,
      audio: false,
      embeddedContext: true,
    });
    expect(response.agentCapabilities?.mcpCapabilities).toEqual({ http: true, sse: true });
    expect(response.agentCapabilities?.sessionCapabilities?.list).toEqual({});
    expect(response.agentCapabilities?.sessionCapabilities?.resume).toEqual({});
  });

  it('negotiates newer clients down to protocol v1', async () => {
    expect((await initialize({}, 99)).protocolVersion).toBe(1);
  });

  it('returns supplied agent metadata', async () => {
    const agentInfo = { name: 'Pythinker Code CLI', version: '9.9.9-test' };
    expect((await initialize({ agentInfo })).agentInfo).toEqual(agentInfo);
  });

  it('omits agent metadata when not supplied', async () => {
    expect((await initialize()).agentInfo).toBeUndefined();
  });
});
