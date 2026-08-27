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
- A relay key. Remote Control refuses to start without one.

## Security

The link grants control of this machine. Do not share the link or the QR code.

The link itself carries no access token: requests arrive through the tunnel, and the Pythinker Code process on this machine adds the bearer token to each one before it reaches the local server. The QR code, the printed link, and the PNG on disk hold no credential.

The relay never receives the bearer token. Pythinker Code presents a separate relay key in the WebSocket handshake, so a relay can admit known machines without holding a credential that controls one.

Every request and response still passes through the relay in the clear, so use a relay you operate or otherwise trust. Rotate the bearer token with `pythinker web rotate-token` if a relay is ever compromised.

## Relay

Traffic reaches the remote device through a relay. Point Remote Control at your own relay with `--relay-origin`:

```sh
pythinker rc --relay-origin https://relay.example.com --relay-key YOUR_RELAY_KEY
```

The relay operator issues the key; it admits your machine to the relay and nothing else. `PYTHINKER_CODE_REMOTE_CONTROL_RELAY` and `PYTHINKER_CODE_REMOTE_CONTROL_RELAY_KEY` set the same two values for `/rc` in the terminal UI and for every run in a shell:

```sh
export PYTHINKER_CODE_REMOTE_CONTROL_RELAY=https://relay.example.com
export PYTHINKER_CODE_REMOTE_CONTROL_RELAY_KEY=YOUR_RELAY_KEY
```

## Stop it

Press `Ctrl-C`. The tunnel closes with the server.
