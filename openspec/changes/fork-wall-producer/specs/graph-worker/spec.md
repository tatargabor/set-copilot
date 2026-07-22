## REMOVED Requirements

### Requirement: Model choice defaults to the fast tier

**Reason**: The fast-tier default was the direct cause of the failure this capability's own
change (`wall-producers` D9) recorded: the Haiku worker produced a mechanically correct but
ungrounded 47-node hairball. In practice the fast tier is not sufficient for a producer that
must judge what matters. The fork producer inherits the parent session's model and cannot
select a tier at all — the requirement has no subject left.

**Migration**: See `fork-producer` → "The fork runs on the parent's model tier". Producers no
longer choose a model; they inherit one.

### Requirement: Cacheable stable prefix

**Reason**: The worker-assembled stable prefix (system prompt + knowledge context +
accumulated graph) does not exist in the fork model. The fork inherits the parent's already-warm
prefix, so cacheability is a property of the base context, not of a worker-built prompt.

**Migration**: See `fork-producer` → "The drawing contract lives in the base context". What used
to be assembled into a worker prefix is now loaded once into the session policy via
`set-copilot prompt`, and inherited by every fork as a cache read.

### Requirement: Direct-to-hub emission

**Reason**: The normative clause "The main session SHALL NOT be on the critical path of a graph
delta" describes the pre-D9 architecture, which the project decided not to build. Under the fork
model the main session's *context* is on the path (deliberately — that is the grounding) while
its *turn* is not, since the fork runs on a separate thread and its output does not return to
the parent. The requirement as written forbids the thing that makes the design work.

**Migration**: See `fork-producer` → "The producer is a fork of the main session" and "The fork
terminates after emitting". Emission still goes straight to the event-source ingest, never
through the SSE broadcast — that part is preserved in `fork-producer` → "The emission seam is
unchanged".

### Requirement: Single structured output, streamed to cut time-to-first-token

**Reason**: This constrained an SDK-driven worker making one structured-output call per tick.
The fork is a Claude Code agent, not a single API call; it legitimately uses tools to ground
itself before emitting. The prohibition on a "multi-turn tool loop in the hot path" was written
to protect latency in a design where the worker sat on every tick — the fork model is
emission-per-need, so the constraint no longer describes a hot path.

**Migration**: See `fork-producer` → "Emission is on demand, not polled". Latency is now governed
by measurement (`wall-feedback-and-replay` 5.1/5.2) rather than by a structural prohibition.

### Requirement: Stateful incremental graph delta

**Reason**: The in-process accumulated-graph state belonged to a persistent worker. A fork is
short-lived and terminates after emitting, so it holds no state across emissions. The
accumulate-and-replay responsibility already lives on the server side (`wall-events.jsonl` is
canonical, per `monitor-wall-display` D7 and `wall-replay`).

**Migration**: Incremental append remains the client's rendering behaviour and the server's
accumulation behaviour; it is no longer a producer requirement. A fork that wants to emit a
delta rather than a full visual reads the current accumulated state from the canonical event
log.
