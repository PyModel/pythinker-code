---
"@pythoughts/pythinker-code": patch
---

Keep the configured provider signed in when a login is abandoned. Backing out at the model picker, or a failure while fetching the model list, no longer clears the existing credentials, and dismissing the provider picker returns to the sign-in screen instead of reporting a failed login.
