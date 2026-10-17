# Remote Control

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

The link grants control of this machine. Do not share the link or the QR code.

The link itself carries no access token: requests arrive through the tunnel, and the Pythinker Code process on this machine adds the bearer token to each one before it reaches the local server. The QR code, the printed link, and the PNG on disk hold no credential.

The relay never receives the bearer token. Each machine creates its own Remote Control secret the first time it starts (`remote-control-secret` in the Pythinker Code data directory), and its link address is derived from that secret. The relay lets a machine register and serve only its own address, so one machine can never take over, serve, or answer for another machine's link. No relay key or sign-in is needed.

To retire a link, stop Remote Control and delete `remote-control-secret`. The next start creates a new secret and a new link, and the old link stops working.

Every request and response still passes through the relay in the clear, so use a relay you operate or otherwise trust. Rotate the bearer token with `pythinker web rotate-token` if a relay is ever compromised.

## Relay

Traffic reaches the remote device through a relay. To use your own relay, set `PYTHINKER_CODE_REMOTE_CONTROL_RELAY` for `pythinker rc`, `pythinker web --remote-control`, and `/rc` in the terminal UI:

```sh
export PYTHINKER_CODE_REMOTE_CONTROL_RELAY=https://relay.example.com
```

## Stop it

Press `Ctrl-C`. The tunnel closes with the server.
