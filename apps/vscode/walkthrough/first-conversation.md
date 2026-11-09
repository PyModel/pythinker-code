# Run your first conversation

1. Open a folder in VS Code. Pythinker works inside your workspace.
2. Type a request in the chat input, for example: "Explain this repository."
3. Press `Enter` to send it.

Start a fresh conversation at any time with `Ctrl+Alt+N` (`Cmd+Alt+N` on Mac).

## Approval modes

Pythinker asks before it runs actions that change your files or your system. Three modes control this:

- **Manual** — Pythinker asks you to approve each sensitive action. This is the default.
- **Auto** — Pythinker approves tool calls and dismisses questions automatically.
- **YOLO** — Pythinker approves regular tool calls automatically, but can still ask you questions.

Type `/auto` or `/yolo` in the chat to change the mode. When a request waits for your decision, the status bar shows a bell and the Pythinker view shows a badge.
