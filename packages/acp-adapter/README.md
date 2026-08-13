# @pythoughts/acp-adapter

Agent Client Protocol adapter for pythinker-code. Exposes the pythinker-code agent over the [Agent Client Protocol](https://agentclientprotocol.com/) so that ACP-compatible clients (editors, IDEs, custom front-ends) can drive a pythinker-code session over stdio.

Part of the [Pythinker Code](https://github.com/PyModel/pythinker-code) monorepo.

## Minimum usage

```ts
import { createPythinkerHarness } from '@pythoughts/pythinker-code-sdk';
import { runAcpServer } from '@pythoughts/acp-adapter';

const harness = await createPythinkerHarness();
await runAcpServer(harness);
```

`runAcpServer` reads JSON-RPC from `process.stdin`, writes to `process.stdout`, and resolves when the client closes the connection. SIGINT and SIGTERM trigger a graceful drain that calls `harness.close()` before the process exits.

See `docs/reference/pythinker-acp.md` for the full capability matrix (which `Agent` methods are wired, which extensions are stubbed, image / MCP support) and `docs/guides/ides.md` for Zed and JetBrains setup.

## License

MIT
