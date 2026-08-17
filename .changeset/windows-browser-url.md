---
'@pymodel/pythinker-code': patch
---

Open the browser on Windows through `rundll32` instead of `cmd /c start`. `cmd` cut every URL at the first `&`, so OAuth logins reached the provider with only the first query parameter and failed with an invalid authorize request.
