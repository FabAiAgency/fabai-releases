# Specs — the source of truth

A spec is a declarative description of one unit of the estate. Nothing here is an n8n file;
n8n files are *compiled output* (`dist/n8n/`). Editing a canvas by hand is how an automation
estate rots — twenty workflows drift into twenty different retry policies, twenty different
error paths and zero shared telemetry. Editing a spec cannot drift, because the boring parts
are generated identically every time.

## Anatomy

```jsonc
{
  "capability": { /* conforms to contracts/capability.schema.json */ },
  "n8n": {
    "trigger": { "kind": "executeWorkflow" | "telegram" | "webhook" | "schedule" | "manual" },
    "nodes":   [ /* steps, see below */ ]
  }
}
```

## Step kinds

| kind | compiles to | notes |
|---|---|---|
| `set` | Set | field assignments |
| `code` | Code | plain JS, runs once per item unless `runOnceForAllItems` |
| `http` | HTTP Request | timeout + retry injected from the manifest |
| `agent` | LangChain Agent (+ model, memory, tools) | `role` resolves through `registry/models.json` |
| `llm` | LLM Chain (+ structured output parser) | for single-shot generation |
| `if` / `switch` | If / Switch | branching |
| `splitOut` / `merge` | Split Out / Merge | fan-out and fan-in |
| `wait` | Wait | polling async provider jobs |
| `call` | Execute Workflow | calls another capability **by id** |
| `guard` | Code + If + Stop&Error | policy / budget / rights / compliance gate |
| `emit` | Code + HTTP | telemetry span event |
| `telegram` / `gdrive` / `gsheets` | respective nodes | channel & storage integrations |

## What the compiler injects for free

Every compiled workflow gets, without the spec asking:

1. **Envelope validation** on entry — wrong `envelope_version` fails fast, loudly.
2. **`span_start` telemetry** with `trace_id` propagation.
3. **Budget guard** before the first billable step.
4. **Retry + timeout** on every `http` step, from the capability manifest.
5. **Provenance append** and **`span_end` telemetry** on exit.
6. **Error Trigger → DLQ** path, with the full envelope preserved for replay.
7. **Sticky-note frames** grouping nodes by `group`, so the compiled canvas reads like the
   hand-drawn originals it replaces.

That list is the entire argument for compiling instead of clicking.
