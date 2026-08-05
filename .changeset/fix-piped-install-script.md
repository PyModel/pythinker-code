---
"@pythoughts/pythinker-code": patch
---

Fix the native install script exiting immediately without installing anything when run the documented way, `curl -fsSL … | bash`, which also broke automatic background updates for native installs.
