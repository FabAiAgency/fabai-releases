# Extending

Four things people actually need to add. None of them requires opening a canvas.

## Add a terminal process

1. Write `specs/terminal/<domain>.<thing>.<verb>.json`.
2. Declare the manifest honestly — `side_effects`, `idempotent`, `compensation`, `providers`,
   `sla`, `retry`, `cost_model`, `requires`. The compiler and the validator both act on it.
3. Describe the steps. Use the smallest set of kinds that works; anything you do not declare
   (envelope validation, telemetry, budget guard, retries, error path, layout) is injected.
4. If it is billable or publishing, give it a compensation — or add it to
   `registry/roadmap.json` under `uncompensable` with a rationale you would defend.
5. `npm run check`.

```jsonc
{
  "capability": {
    "id": "dist.publish.gbp", "version": "1.0.0", "layer": "terminal",
    "title": "Publish to Google Business Profile",
    "summary": "One sentence on what it does and why it is separate from everything else.",
    "owner": "distribution", "maturity": "beta",
    "capability_tags": ["distribute.publish"],
    "side_effects": "publish", "idempotent": true, "compensation": "dist.unpublish.gbp",
    "sla": { "p50_ms": 1200, "p95_ms": 5000, "timeout_ms": 45000 },
    "retry": { "max_attempts": 3, "backoff": "exponential", "base_ms": 2500 },
    "requires": { "secrets": ["GBP_OAUTH"] },
    "verticals": "*", "cost_model": { "estimate_minor_units": 0 }
  },
  "n8n": {
    "trigger": { "kind": "executeWorkflow" },
    "nodes": [
      { "id": "gates", "kind": "guard", "title": "Re-verify Gates", "group": "Publish",
        "with": { "checks": ["compliance", "brand", "rights", "approval"] } },
      { "id": "post", "kind": "http", "title": "Create Local Post", "group": "Publish",
        "with": { "method": "POST", "url": "...", "auth": "oAuth2Api", "body": { } } }
    ]
  }
}
```

Then remove `dist.publish.gbp` from `roadmap.planned` — leaving it there is now a build error,
which is how the roadmap stays honest.

## Add a channel

1. Add it to `registry/channels.json` with its real formats, limits, capabilities and rate
   limits. Set `requires_gates: ["human_approval"]` if it spends money.
2. Write the adapter terminal (above) consuming `contracts/publish-request.schema.json`.
3. Add one `policy_table` row in `registry/policies/routing.json` binding
   `distribute.publish` for that channel.
4. Add the channel to whichever vertical profiles should weight it.

No factory changes. The factories produce a channel-neutral PublishRequest; the adapter speaks
the platform. That is the entire reason for the split.

## Add a vertical

See [`03-vertical-adaptation.md`](03-vertical-adaptation.md#adding-a-vertical). One JSON file,
zero workflow edits, and the validator proves every reference resolves before it can ship.

## Add a vertical specialisation of an existing workflow

When defaults genuinely cannot express the difference, overlay rather than fork:

```jsonc
{
  "extends": "media.video.render",
  "capability": {
    "id": "media.video.render.before_after", "version": "1.0.0",
    "title": "Render Video — Before / After Proof",
    "capability_tags": ["assemble.video"], "verticals": ["local_services", "health_wellness"],
    "side_effects": "spend", "idempotent": true, "compensation": "asset.store.delete"
  },
  "overrides": {
    "timeline": {
      "template": { "transitions": "linear_wipe_600ms", "labels": ["Before", "After"] },
      "code_prepend": "if (!$json.payload.evidence_pair || $json.payload.evidence_pair.generated) {\n  throw new Error('COMPLIANCE_BLOCKED: before/after proof requires captured frames');\n}\n"
    }
  }
}
```

Override keys: `system_append`, `code_prepend`, `code_append`, `role_override`, `template`,
`extra_prompt_fields`. Anything else merges into the step's `with`.

Then bind it in the profile:

```jsonc
"capability_bindings": { "assemble.video": "media.video.render.before_after" }
```

Fixing a bug in the parent fixes every child. No copy can drift, because there are no copies.

## Add a play

Add it to a vertical's `plays` array: an id, an objective, a `when` condition a human can argue
with, and a list of capability *tags*. The validator proves every tag is executable. The
planner will then select it when it fits — and cannot invent one when nothing does.

## House rules

- **Terminals never call terminals sideways.** Declare it in `requires.capabilities` or go
  through a subsystem. The validator rejects dependency cycles.
- **Nothing hard-codes a vertical, a channel or a brand.** If a workflow needs to know, it
  needs a profile value or a capability binding.
- **`dist/` is never hand-edited.** A canvas edit is overwritten by the next build, on purpose.
- **A spec change with no test is a spec change nobody verified.** The suite executes generated
  code; adding a case is usually five lines.
