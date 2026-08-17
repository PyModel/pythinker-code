---
"@pymodel/pythinker-code": minor
---

Report each model's real capabilities in the catalog. Until now `capabilities` carried only what a user had typed into their config file by hand, so for almost every model it was empty. It is now derived from the model itself when the config says nothing, while an explicit list in the config still wins. A provider whose capabilities are genuinely unknown keeps omitting the field rather than claiming the model can do nothing.
