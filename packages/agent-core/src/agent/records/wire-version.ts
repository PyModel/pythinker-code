export const AGENT_WIRE_PROTOCOL_VERSION = '2.0';

export function assertAgentWireProtocolVersion(readVersion: string): void {
  if (readVersion !== AGENT_WIRE_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported agent wire protocol version ${readVersion}; expected ${AGENT_WIRE_PROTOCOL_VERSION}`,
    );
  }
}
