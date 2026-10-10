import { buildStep, buildTrigger, mk, resetIds } from './nodes.mjs';

const GRID_X = 300;
const GRID_Y = 190;

/** Merge a builder's internal connections into the workflow-level map. */
function absorb(target, extra) {
  for (const [name, conn] of Object.entries(extra)) {
    if (!target[name]) { target[name] = conn; continue; }
    for (const [port, outs] of Object.entries(conn)) {
      target[name][port] = target[name][port] ?? [];
      outs.forEach((slot, i) => {
        target[name][port][i] = [...(target[name][port][i] ?? []), ...(slot ?? [])];
      });
    }
  }
}

function link(connections, fromName, fromIndex, toName) {
  if (!toName) return;
  connections[fromName] = connections[fromName] ?? { main: [] };
  connections[fromName].main = connections[fromName].main ?? [];
  while (connections[fromName].main.length <= fromIndex) connections[fromName].main.push([]);
  connections[fromName].main[fromIndex].push({ node: toName, type: 'main', index: 0 });
}

/** Injected preamble: validate the envelope, open a span. Identical in every workflow. */
function envelopeInNode(cap) {
  return mk('code', 'Envelope In', {
    mode: 'runOnceForAllItems',
    jsCode: `// GENERATED preamble — every unit in the estate starts here, identically.
// Rejects an envelope whose MAJOR version this unit does not implement, rather than
// half-processing a shape it does not understand.
const SUPPORTED_MAJOR = 1;
const raw = $json.envelope ?? $json;
const v = String(raw.envelope_version ?? '0.0.0');
if (Number(v.split('.')[0]) !== SUPPORTED_MAJOR) {
  throw new Error('VALIDATION_FAILED: envelope_version ' + v + ' is not supported by ${cap.id}@${cap.version} (needs ' + SUPPORTED_MAJOR + '.x)');
}
for (const f of ['trace_id', 'tenant_id', 'idempotency_key']) {
  if (!raw[f]) throw new Error('VALIDATION_FAILED: envelope.' + f + ' is required');
}
if (raw.deadline_at && Date.parse(raw.deadline_at) < Date.now()) {
  // Fail fast rather than start work that cannot finish in time.
  throw new Error('TIMEOUT: deadline_at ' + raw.deadline_at + ' already passed before ${cap.id} started');
}
return [{ json: {
  ...raw,
  span_id: 'spn_' + Math.random().toString(36).slice(2, 10),
  parent_span_id: raw.span_id ?? null,
  policy: raw.policy ?? {},
  budget: raw.budget ?? {},
  provenance: raw.provenance ?? [],
  _started_at: Date.now(),
  _capability: ${JSON.stringify(cap.id)},
  _capability_version: ${JSON.stringify(cap.version)}
} }];`,
  });
}

function spanStartNode(cap) {
  return mk('code', 'Span Start', {
    mode: 'runOnceForAllItems',
    jsCode: `// GENERATED telemetry — span_start.
const e = $json;
return [{ json: { ...e, _telemetry: {
  event_id: 'evt_' + Math.random().toString(36).slice(2, 12),
  trace_id: e.trace_id, span_id: e.span_id, parent_span_id: e.parent_span_id,
  tenant_id: e.tenant_id, brand_id: e.brand_id ?? null, vertical: e.vertical ?? null,
  capability: ${JSON.stringify(cap.id)}, capability_version: ${JSON.stringify(cap.version)},
  layer: ${JSON.stringify(cap.layer)}, stage: e.stage ?? null,
  event: 'span_start', at: new Date().toISOString()
} } }];`,
  });
}

function budgetGuardNode(cap) {
  return mk('code', 'Budget Guard', {
    mode: 'runOnceForAllItems',
    jsCode: `// GENERATED budget guard — injected because ${cap.id} declares a cost
// (estimate ${cap.cost_model?.estimate_minor_units ?? 0} minor units). A unit that can spend
// money never gets to decide for itself whether it may.
const ESTIMATE = ${cap.cost_model?.estimate_minor_units ?? 0};
const e = $json;
const b = e.budget ?? {};
const cap_ = b.cap_minor_units ?? null;
const spent = b.spent_minor_units ?? 0;
if (cap_ !== null && spent + ESTIMATE > cap_) {
  throw new Error('BUDGET_EXCEEDED: ' + (spent + ESTIMATE) + ' would exceed cap ' + cap_ + ' in ${cap.id}');
}
let tier = e.policy?.model_tier_cap ?? 'frontier';
const soft = b.soft_limit_pct ?? 0.8;
if (cap_ !== null && spent + ESTIMATE > cap_ * soft) {
  tier = { frontier: 'standard', standard: 'small', small: 'nano', nano: 'nano' }[tier] ?? 'small';
}
return [{ json: { ...e, policy: { ...(e.policy ?? {}), model_tier_cap: tier }, _budget_reserved: ESTIMATE } }];`,
  });
}

function spanEndNode(cap) {
  return mk('code', 'Provenance & Span End', {
    mode: 'runOnceForAllItems',
    jsCode: `// GENERATED epilogue — appends exactly one provenance entry and closes the span.
// Provenance is append-only; nothing in the estate is permitted to rewrite an earlier entry.
const e = $('Envelope In').first().json;
const out = $json;
const duration = Date.now() - (e._started_at ?? Date.now());
const entry = {
  capability: ${JSON.stringify(cap.id)},
  version: ${JSON.stringify(cap.version)},
  at: new Date().toISOString(),
  duration_ms: duration,
  model: out._model ?? null,
  provider: out._provider ?? null,
  cost_minor_units: out._cost_minor_units ?? ${cap.cost_model?.estimate_minor_units ?? 0},
  inputs_hash: e.idempotency_key,
  decision_id: out.decision?.decision_id ?? null
};
return [{ json: {
  ...out,
  _envelope: {
    ...e,
    span_id: e.parent_span_id,
    provenance: [...(e.provenance ?? []), entry],
    budget: { ...(e.budget ?? {}), spent_minor_units: (e.budget?.spent_minor_units ?? 0) + (entry.cost_minor_units ?? 0) }
  },
  _telemetry: {
    event_id: 'evt_' + Math.random().toString(36).slice(2, 12),
    trace_id: e.trace_id, span_id: e.span_id, tenant_id: e.tenant_id,
    capability: ${JSON.stringify(cap.id)}, capability_version: ${JSON.stringify(cap.version)},
    layer: ${JSON.stringify(cap.layer)}, event: 'span_end', status: out.error ? 'error' : 'ok',
    duration_ms: duration, cost_minor_units: entry.cost_minor_units,
    error_code: out.error?.code ?? null, at: new Date().toISOString()
  }
} }];`,
  });
}

function telemetrySinkNode() {
  return mk('http', 'Emit Telemetry', {
    method: 'POST', url: '={{ $env.MOS_TELEMETRY_URL }}',
    authentication: 'predefinedCredentialType', nodeCredentialType: 'headerAuth',
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json._telemetry) }}',
    options: { timeout: 5000 },
  }, { onError: 'continueRegularOutput' });
}

/** Error path. Every workflow gets one; none has to remember to. */
function errorPath(cap) {
  const trigger = mk('errorTrigger', 'On Error', {});
  const park = mk('http', 'Park to DLQ', {
    method: 'POST', url: '={{ $env.MOS_STATE_URL }}/dlq',
    authentication: 'predefinedCredentialType', nodeCredentialType: 'headerAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({
  capability: ${JSON.stringify(cap.id)},
  capability_version: ${JSON.stringify(cap.version)},
  trace_id: $json.execution?.id,
  error: { message: $json.execution?.error?.message, node: $json.execution?.lastNodeExecuted, stack: $json.execution?.error?.stack },
  envelope: $json.execution?.data,
  replayable: true,
  at: new Date().toISOString()
}) }}`,
    options: { timeout: 10000 },
  }, { onError: 'continueRegularOutput' });
  const notify = mk('telegram', 'Notify Ops', {
    resource: 'message', operation: 'sendMessage', chatId: '={{ $env.MOS_OPS_CHAT_ID }}',
    text: `=Run failed in ${cap.id}\n{{ $json.execution?.error?.message }}\nNode: {{ $json.execution?.lastNodeExecuted }}\nReplay: mos replay {{ $json.execution?.id }}`,
    additionalFields: {},
  }, { onError: 'continueRegularOutput' });
  return {
    nodes: [trigger, park, notify],
    connections: {
      [trigger.name]: { main: [[{ node: park.name, type: 'main', index: 0 }]] },
      [park.name]: { main: [[{ node: notify.name, type: 'main', index: 0 }]] },
    },
  };
}

/**
 * Canvas layout.
 *
 * Compiled graphs are read by humans during incidents, so the layout is not cosmetic.
 * Rules: strict left-to-right columns by shortest-path depth; one lane per node within a
 * column; a node with AI sub-nodes reserves the lane beneath it so nothing ever overlaps;
 * cycles (poll loops) are laid out on their shortest path and the back-edge simply routes
 * backwards; the error path gets its own band well below the main flow.
 */
const COL_W = 340;   // horizontal pitch between columns
const LANE_H = 200;  // vertical pitch between lanes
const SUB_DROP = 250; // how far AI sub-nodes hang below their parent
const SUB_W = 210;   // horizontal pitch between sibling sub-nodes
const MAX_COLS = 9;   // wrap the chain into a new band after this many columns
const BAND_GAP = 320; // vertical breathing room between bands
const ORIGIN = [240, 300];

function shortestDepths(connections, roots) {
  // Plain BFS with a visited set. The visited check is what makes a cyclic graph
  // (every polling loop is one) terminate instead of spinning forever.
  const depth = new Map();
  const queue = [];
  for (const r of roots) { if (!depth.has(r)) { depth.set(r, 0); queue.push(r); } }
  while (queue.length) {
    const name = queue.shift();
    const d = depth.get(name);
    for (const slot of connections[name]?.main ?? []) {
      for (const edge of slot ?? []) {
        if (depth.has(edge.node)) continue;
        depth.set(edge.node, d + 1);
        queue.push(edge.node);
      }
    }
  }
  return depth;
}

function layout(nodes, connections, roots, errorNodeNames = new Set()) {
  const byName = new Map(nodes.map((n) => [n.name, n]));

  // Which nodes are AI sub-nodes, and who owns them.
  const parentOf = new Map();
  const childrenOf = new Map();
  for (const [name, conn] of Object.entries(connections)) {
    for (const [port, slots] of Object.entries(conn)) {
      if (port === 'main') continue;
      for (const slot of slots ?? []) {
        for (const e of slot ?? []) {
          parentOf.set(name, e.node);
          childrenOf.set(e.node, [...(childrenOf.get(e.node) ?? []), name]);
        }
      }
    }
  }

  const mainNodes = nodes.filter((n) => !parentOf.has(n.name) && !errorNodeNames.has(n.name));
  const depth = shortestDepths(connections, roots.filter((r) => !errorNodeNames.has(r)));
  const maxDepth = Math.max(0, ...[...depth.values()]);

  const columns = new Map();
  for (const n of mainNodes) {
    const d = depth.has(n.name) ? depth.get(n.name) : maxDepth + 1;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }

  // Long chains wrap into bands instead of running off to 7000px. Each band is a normal
  // left-to-right read; the hand-off edge between bands is the only long line on the canvas.
  const sortedDepths = [...columns.keys()].sort((a, b) => a - b);
  const placement = new Map();
  const bandLanes = new Map();
  for (const d of sortedDepths) {
    const band = Math.floor(d / MAX_COLS);
    const col = d % MAX_COLS;
    let lane = 0;
    for (const n of columns.get(d)) {
      placement.set(n.name, { band, col, lane });
      lane += childrenOf.has(n.name) ? 2.4 : 1;
    }
    bandLanes.set(band, Math.max(bandLanes.get(band) ?? 0, lane));
  }

  const bandY = new Map();
  let y = ORIGIN[1];
  for (const band of [...bandLanes.keys()].sort((a, b) => a - b)) {
    bandY.set(band, y);
    y += bandLanes.get(band) * LANE_H + BAND_GAP;
  }

  for (const n of mainNodes) {
    const p = placement.get(n.name);
    if (!p) continue;
    n.position = [ORIGIN[0] + p.col * COL_W, Math.round(bandY.get(p.band) + p.lane * LANE_H)];
  }

  for (const [parent, kids] of childrenOf) {
    const p = byName.get(parent);
    if (!p) continue;
    p._hasSub = true;
    const span = (kids.length - 1) * SUB_W;
    kids.forEach((k, i) => {
      const n = byName.get(k);
      if (n) n.position = [Math.round(p.position[0] - span / 2 + i * SUB_W), p.position[1] + SUB_DROP];
    });
  }

  // Error path sits in its own band under everything, so an incident reader finds it
  // instantly and it never tangles with the happy path.
  const lowest = Math.max(ORIGIN[1], ...nodes.filter((n) => !errorNodeNames.has(n.name)).map((n) => n.position[1]));
  let ex = ORIGIN[0];
  for (const name of errorNodeNames) {
    const n = byName.get(name);
    if (!n) continue;
    n.position = [ex, lowest + BAND_GAP + 120];
    ex += COL_W;
  }

  return nodes;
}

/**
 * Sticky-note frames per `group`. The originals used coloured frames to make a canvas
 * legible at a glance; the compiler reproduces that automatically so every workflow in the
 * estate is annotated the same way without anyone drawing a box by hand.
 */
const PAD_X = 90;
const PAD_TOP = 130;
const PAD_BOTTOM = 110;
const NODE_W = 180;
const NODE_H = 90;

function frames(nodes, groupsByName, order) {
  // A group whose nodes are not contiguous on the canvas (the envelope preamble and the
  // telemetry epilogue are the obvious case) gets one box per cluster. One box spanning the
  // whole canvas would swallow every other frame and make the annotation worse than none.
  const members = new Map();
  for (const n of nodes) {
    const g = groupsByName.get(n.name);
    if (!g) continue;
    members.set(g, [...(members.get(g) ?? []), n]);
  }
  const boxes = new Map();
  for (const [g, ns] of members) {
    const bands = new Map();
    for (const n of ns) bands.set(n.position[1], [...(bands.get(n.position[1]) ?? []), n]);
    const clusters = [];
    for (const rowNodes of bands.values()) {
      const sorted = [...rowNodes].sort((a, b) => a.position[0] - b.position[0]);
      let cur = [sorted[0]];
      for (const n of sorted.slice(1)) {
        if (n.position[0] - cur[cur.length - 1].position[0] > COL_W * 1.6) { clusters.push(cur); cur = [n]; }
        else cur.push(n);
      }
      clusters.push(cur);
    }
    // Merge clusters that share a column range but sit in different lanes of one band.
    const merged = [];
    for (const c of clusters) {
      const x1 = Math.min(...c.map((n) => n.position[0]));
      const x2 = Math.max(...c.map((n) => n.position[0]));
      const hit = merged.find((m) => !(x2 < m.x1 - COL_W || x1 > m.x2 + COL_W) && Math.abs(Math.min(...c.map((n) => n.position[1])) - m.y1) < LANE_H * 3);
      if (hit) { hit.nodes.push(...c); hit.x1 = Math.min(hit.x1, x1); hit.x2 = Math.max(hit.x2, x2); }
      else merged.push({ nodes: [...c], x1, x2, y1: Math.min(...c.map((n) => n.position[1])) });
    }
    merged.forEach((m, i) => {
      const hasSub = m.nodes.some((n) => n._hasSub);
      boxes.set(merged.length > 1 ? `${g}##${i}` : g, {
        label: g,
        x1: Math.min(...m.nodes.map((n) => n.position[0])),
        y1: Math.min(...m.nodes.map((n) => n.position[1])),
        x2: Math.max(...m.nodes.map((n) => n.position[0] + NODE_W)),
        y2: Math.max(...m.nodes.map((n) => n.position[1] + NODE_H)) + (hasSub ? SUB_DROP : 0),
      });
    });
  }
  const palette = { 'Envelope & Telemetry': 4, 'Error & DLQ': 3 };
  const rotating = [5, 6, 7, 2, 1, 4];
  let i = 0;
  return [...boxes.entries()]
    .sort((a, b) => (order.indexOf(a[1].label) - order.indexOf(b[1].label)))
    .map(([key, b]) => mk('sticky', `Frame · ${key}`, {
      content: `## ${b.label}`,
      height: Math.round(b.y2 - b.y1 + PAD_TOP + PAD_BOTTOM),
      width: Math.round(b.x2 - b.x1 + PAD_X * 2),
      color: palette[b.label] ?? rotating[i++ % rotating.length],
    }, { position: [Math.round(b.x1 - PAD_X), Math.round(b.y1 - PAD_TOP)] }));
}

export function compile(spec, registry) {
  resetIds();
  const cap = spec.capability;
  const ctx = { capability: cap, registry };
  const steps = spec.n8n.nodes;
  const byId = new Map(steps.map((s) => [s.id, s]));

  const built = new Map();
  const nodes = [];
  const connections = {};
  const groupsByName = new Map();

  for (const step of steps) {
    const b = buildStep(step, ctx);
    built.set(step.id, b);
    for (const n of b.nodes) {
      nodes.push(n);
      if (step.group) groupsByName.set(n.name, step.group);
    }
    absorb(connections, b.connections);
  }

  const entryOf = (stepId) => built.get(stepId)?.entry;

  // Steps that declare the same `parallel_group` and sit next to each other in the spec run
  // CONCURRENTLY: the shared predecessor feeds every member, and every member feeds whatever
  // follows the group (normally a merge). Without this, a spec that says "these three are
  // parallel" would silently compile to a slow serial chain — the gap between what the spec
  // claims and what runs is exactly the kind of drift the compiler exists to prevent.
  const groupKey = (st) => st?.parallel_group ?? st?.with?.parallel_group ?? null;
  const groupSpan = new Map(); // step index -> [startIdx, endIdx]
  for (let i = 0; i < steps.length; i++) {
    const k = groupKey(steps[i]);
    if (!k || groupSpan.has(i)) continue;
    let j = i;
    while (j + 1 < steps.length && groupKey(steps[j + 1]) === k) j++;
    if (j > i) for (let x = i; x <= j; x++) groupSpan.set(x, [i, j]);
  }
  const targetsAt = (idx) => {
    if (idx >= steps.length) return [];
    const span = groupSpan.get(idx);
    if (!span) return [entryOf(steps[idx].id)];
    return steps.slice(span[0], span[1] + 1).map((st) => entryOf(st.id));
  };
  const seqAfter = (i) => {
    const span = groupSpan.get(i);
    return targetsAt(span ? span[1] + 1 : i + 1);
  };
  const linkAll = (conns, from, idx, targets) => {
    for (const t of (Array.isArray(targets) ? targets : [targets])) link(conns, from, idx, t);
  };

  // Wire the declared graph. Absent `next` means "the next step in the array", which keeps
  // the common linear case free of boilerplate.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const b = built.get(step.id);
    const next = step.next;

    // A step whose failure should divert (onError: "route:<id>") gets n8n's error output
    // wired to that step, so a provider fallback is a real edge on the canvas rather than
    // a comment nobody enforces.
    if (b.exits._error && String(step.onError).startsWith('route:')) {
      link(connections, b.exits._error[0], b.exits._error[1], entryOf(String(step.onError).slice(6)));
    }

    if (b.exits.true && b.exits.false) {
      const t = typeof next === 'object' && next !== null ? next.true : undefined;
      const f = typeof next === 'object' && next !== null ? next.false : undefined;
      linkAll(connections, b.exits.true[0], b.exits.true[1], t === undefined || t === null ? seqAfter(i) : entryOf(t));
      linkAll(connections, b.exits.false[0], b.exits.false[1], f === undefined ? [] : f === null ? seqAfter(i) : entryOf(f));
      continue;
    }

    if (Object.keys(b.exits).some((k) => k !== 'default' && k !== '_fallback' && k !== '_error')) {
      for (const [caseName, [node, idx]] of Object.entries(b.exits)) {
        if (['default', '_fallback', '_error'].includes(caseName)) continue;
        const target = typeof next === 'object' && next !== null ? next[caseName] : undefined;
        linkAll(connections, node, idx, target === undefined ? seqAfter(i) : target === null ? [] : entryOf(target));
      }
      if (b.exits._fallback) {
        const fb = step.with?.fallback;
        linkAll(connections, b.exits._fallback[0], b.exits._fallback[1], fb && byId.has(fb) ? entryOf(fb) : seqAfter(i));
      }
      continue;
    }

    const [node, idx = 0] = b.exits.default;
    if (typeof next === 'string') link(connections, node, idx, entryOf(next));
    else if (next === null) { /* explicit terminal */ }
    else linkAll(connections, node, idx, seqAfter(i));
  }

  // Preamble.
  const triggers = (Array.isArray(spec.n8n.trigger) ? spec.n8n.trigger : [spec.n8n.trigger ?? { kind: 'executeWorkflow' }]).map(buildTrigger);
  const envIn = envelopeInNode(cap);
  const spanStart = spanStartNode(cap);
  const billable = (cap.cost_model?.estimate_minor_units ?? 0) > 0;
  const guard = billable ? budgetGuardNode(cap) : null;
  const preamble = [envIn, spanStart, ...(guard ? [guard] : [])];
  for (const t of triggers) link(connections, t.name, 0, envIn.name);
  link(connections, envIn.name, 0, spanStart.name);
  if (guard) { link(connections, spanStart.name, 0, guard.name); linkAll(connections, guard.name, 0, targetsAt(0)); }
  else linkAll(connections, spanStart.name, 0, targetsAt(0));

  // Epilogue: anything with no outbound main edge terminates into the span close.
  const spanEnd = spanEndNode(cap);
  const sink = telemetrySinkNode();
  link(connections, spanEnd.name, 0, sink.name);
  const hasOut = (name) => (connections[name]?.main ?? []).some((slot) => (slot ?? []).length);
  // Only AI SUB-nodes are excluded here. An agent or LLM chain is a main-flow node and must
  // terminate into the span close like any other; excluding it by package prefix was a bug
  // that left those workflows with no provenance entry at all.
  const AI_SUBNODE = /^@n8n\/n8n-nodes-langchain\.(lmChat|outputParser|memory|tool|embeddings|vectorStore|retriever)/;
  const terminalCandidates = nodes.filter((n) => !hasOut(n.name) && n.type !== 'n8n-nodes-base.stopAndError' && !AI_SUBNODE.test(n.type));
  for (const n of terminalCandidates) link(connections, n.name, 0, spanEnd.name);

  const err = errorPath(cap);
  absorb(connections, err.connections);

  const all = [...triggers, ...preamble, ...nodes, spanEnd, sink, ...err.nodes];
  const errorNames = new Set(err.nodes.map((n) => n.name));
  layout(all, connections, triggers.map((t) => t.name), errorNames);
  for (const n of preamble) groupsByName.set(n.name, 'Envelope In');
  groupsByName.set(spanEnd.name, 'Telemetry Out');
  groupsByName.set(sink.name, 'Telemetry Out');
  for (const n of err.nodes) groupsByName.set(n.name, 'Error & DLQ');
  const groupOrder = ['Envelope In', ...spec.n8n.nodes.map((s2) => s2.group).filter(Boolean), 'Telemetry Out', 'Error & DLQ'];
  const stickies = frames(all, groupsByName, groupOrder);
  for (const n of all) delete n._hasSub; // layout scratch, never emitted

  return {
    name: `[${cap.layer}] ${cap.title}`,
    nodes: [...stickies, ...all],
    connections,
    settings: {
      executionOrder: 'v1',
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all',
      saveExecutionProgress: true,
      errorWorkflow: '',
      timezone: 'UTC',
      executionTimeout: Math.ceil((cap.sla?.timeout_ms ?? 300000) / 1000),
    },
    tags: [
      { name: `mos:${cap.layer}` },
      { name: `mos:${cap.maturity ?? 'beta'}` },
      ...(cap.capability_tags ?? []).map((t) => ({ name: `tag:${t}` })),
    ],
    meta: {
      mos: {
        capability_id: cap.id,
        version: cap.version,
        layer: cap.layer,
        owner: cap.owner ?? null,
        side_effects: cap.side_effects,
        idempotent: cap.idempotent,
        compensation: cap.compensation ?? null,
        verticals: cap.verticals ?? '*',
        compiled_at: null,
        compiled_from: spec._file?.split('/marketing-os/')[1] ?? null,
        extends: spec._extends ?? null,
        generated: 'Compiled by marketing-os/compiler. Edit the spec, not this file — canvas edits are overwritten on the next build.',
      },
    },
    pinData: {},
  };
}
