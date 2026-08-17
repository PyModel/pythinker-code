export default {
  signIn: 'Sign in with ChatGPT',
  waiting: 'Waiting for the browser sign-in…',
  pasteHint:
    'Port 1455 is busy, so the browser cannot hand the result back. Finish the sign-in, then paste the address bar URL here.',
  pasteLabel: 'Redirect URL',
  pastePlaceholder: 'http://localhost:1455/auth/callback?code=…',
  submit: 'Finish sign-in',
  cancel: 'Cancel',
  completed: 'Signed in to OpenAI Codex. Model: {model}',
  failed: 'Sign-in failed: {message}',
} as const;
