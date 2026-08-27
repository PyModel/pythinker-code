# Remote Control

::: warning Experimental
Remote Control is experimental. Enable it with `PYTHINKER_CODE_EXPERIMENTAL_REMOTE_CONTROL=1`, or turn on every experiment with `PYTHINKER_CODE_EXPERIMENTAL_FLAG=1`.
:::

Remote Control makes the local web UI reachable from your phone or another computer. The session still runs on this machine; only the screen moves.

## Start it

```sh
pythinker rc
```

`pythinker web --remote-control` does the same thing. Use `/remote-control` (or `/rc`) in the terminal UI to hand the current session over.

The terminal prints a QR code, a link, and the path of a PNG copy of the QR code. Scan the code with the remote device, or open the link there.

## Requirements

- The server must bind a loopback host. Remote Control refuses a `--host` bind.
- Bearer-token auth must stay on. Remote Control refuses `--dangerous-bypass-auth`.
- One Remote Control session per machine. A second start reports the link the first one is using.

## Security

The link grants control of this machine. It carries the access token in its URL fragment, which the browser keeps to itself and never sends to the relay. Do not share the link or the QR code.

## Relay

Traffic reaches the remote device through a relay. Set `relayOrigin` to point at your own relay; the default is `https://code-rc.pythinker.com`.

## Stop it

Press `Ctrl+C`. The tunnel closes with the server.
