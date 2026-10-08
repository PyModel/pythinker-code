---
"@pymodel/pythinker-code": patch
---

Glob filters on the server file endpoints now follow standard glob syntax: `**/` matches whole path segments (so `a/**/b` no longer matches `a/xxb`), and brace sets and character classes are expanded instead of matched literally.
