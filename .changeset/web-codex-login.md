---
'@pymodel/pythinker-code': minor
---

Add OpenAI Codex sign-in to the web and desktop app. The provider dialog now offers "Sign in with ChatGPT" next to the API-key form: the server runs the OAuth exchange, writes the credentials, and reports only which model it selected. When port 1455 is taken, the dialog asks for the redirect URL instead.
