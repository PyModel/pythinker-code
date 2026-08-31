# Use Pythinker Code in a browser

Pythinker Code includes a local browser UI. It uses the same local sessions, configuration, and credentials as the terminal app.

## Start the web UI

1. Open a terminal in your project.
2. Run:

```sh
pythinker web
```

3. Keep the terminal open. The command opens the browser when the server is ready.

If the browser does not open, copy the local URL printed in the terminal. The URL contains an access token. Do not share it.

Use `/web` in the terminal UI to open the current session in the browser.

## What the web UI provides

- Start and resume sessions
- Stream assistant output and tool activity
- Review approvals and file changes
- Browse workspace files and open them from **Explorer** in the sidebar
- Combine two models with automatic **Expert Talk** openings, reciprocal reviews, and Fusion
- Use supported slash commands, including `/goal` and `/compact`
- View the same session data as the terminal UI

## Combine models with Expert Talk

Expert Talk is experimental and requires the v2 engine. Start the web UI with the feature enabled:

```sh
PYTHINKER_CODE_EXPERIMENTAL_EXPERT_TALK=1 pythinker web
```

Select **Expert Talk**, choose different Fusion Lead and Peer Expert models, then select **Use for next message**. For that message, both models create read-only openings and review each other. The Fusion Lead then creates one fresh final answer automatically. The normal transcript shows that answer; expand the Expert Talk panel to inspect the openings, reviews, attribution, and usage.

The selected pair remains available in the session, but each activation applies to one accepted message. Press `Esc` to cancel an active run. **Take** and **Build from Fusion** remain explicit actions.

## Server options

```sh
pythinker web --no-open
pythinker web --port 58628
pythinker web --host
```

`--host` listens on all network interfaces. Use it only on a trusted network and keep the token secret. `--dangerous-bypass-auth` removes authentication; do not use it on a shared or untrusted network.

The default address is `http://127.0.0.1:58627`. When that port is busy, Pythinker tries the next port.

## Stop the server

Press `Ctrl-C` in the terminal that runs `pythinker web`.

## Next steps

- [pythinker command](../reference/pythinker-command.md#pythinker-web) — all web-server options
- [Server API](../reference/server-api.md) — REST and WebSocket integration
