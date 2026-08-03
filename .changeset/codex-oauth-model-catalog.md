---
"@pythoughts/pythinker-code": patch
---

Update OpenAI Codex OAuth for the new model catalog: bump the models client_version gate to 0.145.0 so the gpt-5.6 family appears, carry each model's supported reasoning efforts into config, send real max effort on the wire (ultra maps in as max), clamp requests to what each model supports, and default Codex sign-in to the top supported effort.
