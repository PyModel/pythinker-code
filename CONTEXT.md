# Pythinker Code

Pythinker Code is a provider-agnostic AI coding agent for terminal, browser, desktop, and editor workflows.

## Language

**Expert Talk**:
A structured conversation between two user-selected AI models that returns one fused answer.
_Avoid_: Debate mode, fusion mode

**Expert Talk pair**:
The two ordered configured model IDs saved for future Expert Talk runs.
_Avoid_: Global pair, secondary model

**Configured model ID**:
The stable catalog key that identifies one configured model record and can be stored in an Expert Talk pair.
_Avoid_: Display name, provider model name, loose alias

**Effective model binding**:
The immutable execution identity produced for one Expert Talk role after current catalog and routing validation.
_Avoid_: Selected model, live alias

**Pair collapse**:
An Expert Talk admission failure where two configured selections resolve to the same effective execution target.
_Avoid_: Duplicate model choice

**Expert Talk admission**:
The pre-acceptance validation that resolves and freezes an eligible, distinct pair for one run.
_Avoid_: Provider ping, opening stage

**Fusion Lead**:
The first model in an Expert Talk pair. It participates as an equal expert, then its immutable model binding supplies a fresh inference for fusion.
_Avoid_: Architect, judge, Model 1

**Peer Expert**:
The second model in an Expert Talk pair. It participates as an equal expert in opening and peer review but does not own fusion.
_Avoid_: Secondary model, Model 2

**Expert Talk activation**:
The transient intent to use Expert Talk for the next accepted user turn.
_Avoid_: Expert Talk mode, persistent activation

**Expert Talk run**:
One recorded Expert Talk execution owned by one accepted user turn.
_Avoid_: Resumed run, shared run

**Expert Talk exchange**:
Two independent openings followed by one symmetric peer review between the run-scoped Fusion Lead and Peer Expert.
_Avoid_: Debate, adaptive conversation

**Fused answer**:
The single direct response produced by a fresh Fusion Lead inference after the Expert Talk exchange.
_Avoid_: Verdict, winning answer

**Fusion notes**:
Structured consensus, divergence, uncertainty, and attribution stored with an Expert Talk run but excluded from the normal assistant answer.
_Avoid_: Diagnostic appendix, debate transcript

**Expert Talk stage artifact**:
An immutable complete or partial opening, review, or fusion output owned by one role and stage and kept outside the normal transcript.
_Avoid_: Participant message, hidden memory

**Expert Talk result**:
The versioned successful-run record that contains the fused answer and separate fusion notes.
_Avoid_: Meeting transcript, winning opinion

**Expert Talk retry**:
A new run for the same accepted turn input that reruns admission and every stage without resuming participants or reusing artifacts.
_Avoid_: Resume, fusion-only retry
