#!/usr/bin/env node
/**
 * Behavioural tests. These do not check that files exist — the validator does that.
 * They EXECUTE the generated code (routing resolvers, envelope guards, lint passes) with
 * stubbed n8n globals, because the only interesting question about generated code is
 * whether it behaves correctly, not whether it parses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSpecs, loadRegistry, ROOT } from '../compiler/load.mjs';
import { buildResolverSource } from '../compiler/router.mjs';

let pass = 0;
const failures = [];
const test = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { failures.push({ name, message: e.message }); }
};
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg ?? ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg ?? 'expected truthy'); };

const specs = loadSpecs();
const registry = loadRegistry();
const wf = (layer, id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'n8n', layer, `${id}.json`), 'utf8'));
const nodeNames = (w) => w.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').map((n) => n.name);

/** Runs an n8n Code-node body with stubbed globals. */
function runCode(src, { json = {}, nodes = {}, env = {}, binary = null } = {}) {
  const $ = (name) => ({ first: () => ({ json: nodes[name] ?? {} }), all: () => [{ json: nodes[name] ?? {} }] });
  const $input = { all: () => (Array.isArray(json) ? json.map((j) => ({ json: j })) : [{ json }]) };
  const fn = new Function('$', '$json', '$env', '$binary', '$input', '$runIndex', '$execution', 'require', src);
  return fn($, json, env, binary, $input, 0, { customData: { get: () => undefined } }, (m) => import.meta.require?.(m) ?? require_(m));
}
const require_ = (m) => { if (m === 'crypto') return crypto_; throw new Error('unstubbed require: ' + m); };
const crypto_ = await import('node:crypto').then((m) => m.default);

// ─────────────────────────────────────────────────────────────── routing engine
const resolverFor = (tag) => buildResolverSource({ tag, routing: registry.routing, verticals: registry.verticalsResolved });
const resolve = (tag, envelope, json = {}) => {
  const src = resolverFor(tag);
  const fn = new Function('$', '$json', src);
  return fn(() => ({ first: () => ({ json: envelope }) }), json)[0].json;
};
const baseEnv = (over = {}) => ({
  trace_id: 'trc_000000000001', tenant_id: 't_test', vertical: 'generic',
  policy: { compliance_profile: 'standard' }, budget: { cap_minor_units: 10000, spent_minor_units: 0 },
  payload: { brief: { offer: { type: 'product_digital' }, message: { key_claims: [] }, channels: [], confidence: 0.9 } },
  ...over,
});

test('routing: a vertical binding beats the policy table', () => {
  const e = baseEnv({ vertical: 'ecommerce_dtc' });
  const r = resolve('produce.image.prompt', e, { brief: e.payload.brief });
  eq(r.resolved_capability, 'prompt.image.compose.product_studio');
  eq(r.routing.binding_source, 'vertical_binding');
});

test('routing: home_goods inherits its parent vertical binding', () => {
  const e = baseEnv({ vertical: 'home_goods' });
  const r = resolve('assemble.video', e, { brief: e.payload.brief, context: {} });
  eq(r.resolved_capability, 'media.video.render.explainer_wide');
});

test('routing: with no vertical binding, the policy table decides on offer type', () => {
  const e = baseEnv({ payload: { brief: { offer: { type: 'service' }, message: { key_claims: [] } } } });
  const r = resolve('produce.image.prompt', e, { brief: e.payload.brief });
  eq(r.resolved_capability, 'prompt.image.compose.field_proof');
  eq(r.routing.binding_source, 'policy_table');
});

test('routing: an unmatched tag falls back to its declared default', () => {
  const e = baseEnv({ payload: { brief: { offer: { type: 'event' }, message: { key_claims: [] } } } });
  const r = resolve('produce.copy.longform', e, { brief: e.payload.brief });
  eq(r.resolved_capability, 'copy.longform.generate');
});

test('routing: an exhausted budget vetoes before anything binds', () => {
  const e = baseEnv({ budget: { cap_minor_units: 100, spent_minor_units: 100 } });
  const r = resolve('produce.image', e, { brief: e.payload.brief });
  ok(r.vetoed, 'expected a veto');
  eq(r.error.code, 'BUDGET_EXCEEDED');
  eq(r.resolved_capability, null);
});

test('routing: a regulated claim raises an approval constraint without blocking the bind', () => {
  const e = baseEnv({ payload: { brief: { offer: { type: 'service' }, message: { key_claims: [{ text: 'reverses hair loss', risk: 'regulated' }] } } } });
  const r = resolve('produce.copy.short', e, { brief: e.payload.brief });
  ok(r.resolved_capability, 'should still bind');
  eq(r.constraints.map((c) => c.reason_code), ['REGULATED_CLAIM']);
});

test('routing: a sensitive-audience regex rule fires (inline (?i) flag supported)', () => {
  const e = baseEnv({ payload: { brief: { offer: { type: 'service' }, audience: { description: 'Parents of a CHILD under 18' }, message: { key_claims: [] } } } });
  const r = resolve('produce.copy.short', e, { brief: e.payload.brief });
  ok(r.constraints.some((c) => c.reason_code === 'SENSITIVE_AUDIENCE'), 'expected SENSITIVE_AUDIENCE constraint');
});

test('routing: every decision carries an auditable record', () => {
  const e = baseEnv({ vertical: 'b2b_saas' });
  const r = resolve('produce.image.prompt', e, { brief: e.payload.brief });
  ok(r.decision.decision_id, 'decision_id');
  ok(r.decision.rationale, 'rationale');
  eq(r.decision.kind, 'capability_binding');
  eq(r.decision.chosen, r.resolved_capability);
});

// ─────────────────────────────────────────────────── profile & spec inheritance
test('verticals: inheritance deep-merges, child values win', () => {
  const hg = registry.verticalsResolved.home_goods;
  ok(hg.channels.weights.instagram, 'inherited a channel weight from ecommerce_dtc');
  ok(hg.creative.image_style.includes('interior'), 'overrode creative style');
  eq(hg.taxonomy.buying_cycle_days, 45, 'overrode buying cycle');
  ok(hg.message.lexicon.banned.includes('lasts forever'), 'overrode banned lexicon');
});

test('verticals: b2b_industrial inherits two levels (generic -> b2b_saas -> industrial)', () => {
  const bi = registry.verticalsResolved.b2b_industrial;
  ok(bi.message.cta_ladder?.length, 'inherited cta_ladder from generic');
  eq(bi.taxonomy.buying_cycle_days, 180, 'own buying cycle');
  ok(bi.channels.excluded.includes('instagram'), 'own channel exclusions');
});

test('specs: a vertical overlay inherits the parent graph and appends to the prompt', () => {
  const base = specs.get('prompt.image.compose');
  const overlay = specs.get('prompt.image.compose.product_studio');
  eq(overlay.n8n.nodes.length, base.n8n.nodes.length, 'same node count as parent');
  ok(overlay.n8n.nodes[0].with.system.includes('PRODUCT DISCIPLINE'), 'appended discipline block');
  ok(overlay.n8n.nodes[0].with.system.includes('subject -> action'), 'kept the parent system prompt');
  eq(overlay.capability.id, 'prompt.image.compose.product_studio', 'kept its own id');
});

test('specs: a render overlay injects its evidence guard before the parent code', () => {
  const overlay = specs.get('media.video.render.before_after');
  const timeline = overlay.n8n.nodes.find((n) => n.id === 'timeline');
  ok(timeline.with.code.startsWith('// Evidence guard'), 'prepended guard');
  ok(timeline.with.code.includes('const DIMS'), 'kept parent timeline logic');
});

// ────────────────────────────────────────────────────────── compiler invariants
test('compiler: every workflow gets the envelope preamble and telemetry epilogue', () => {
  for (const [id, spec] of specs) {
    const names = nodeNames(wf(spec._layer, id));
    ok(names.includes('Envelope In'), `${id} missing Envelope In`);
    ok(names.includes('Span Start'), `${id} missing Span Start`);
    ok(names.includes('Provenance & Span End'), `${id} missing span close`);
    ok(names.includes('Emit Telemetry'), `${id} missing telemetry sink`);
  }
});

test('compiler: every workflow gets an error path to the DLQ', () => {
  for (const [id, spec] of specs) {
    const names = nodeNames(wf(spec._layer, id));
    ok(names.includes('On Error') && names.includes('Park to DLQ'), `${id} missing error path`);
  }
});

test('compiler: a budget guard is injected for billable capabilities only', () => {
  const billable = wf('terminal', 'media.image.generate');
  ok(nodeNames(billable).includes('Budget Guard'), 'billable capability should be guarded');
  const free = wf('terminal', 'media.captions.generate');
  ok(!nodeNames(free).includes('Budget Guard'), 'zero-cost capability should not be guarded');
});

test('compiler: HTTP nodes inherit retry settings from the manifest', () => {
  const w = wf('terminal', 'media.image.generate');
  const http = w.nodes.find((n) => n.name === 'Generate Image');
  eq(http.retryOnFail, true);
  eq(http.maxTries, 3);
  eq(http.waitBetweenTries, 3000);
});

test('compiler: onError route wires the provider fallback as a real edge', () => {
  const w = wf('terminal', 'media.image.generate');
  const gen = w.nodes.find((n) => n.name === 'Generate Image');
  eq(gen.onError, 'continueErrorOutput');
  const errorSlot = w.connections['Generate Image'].main[1] ?? [];
  eq(errorSlot.map((e) => e.node), ['Fallback Provider']);
});

test('compiler: a parallel group fans out from one predecessor and rejoins', () => {
  const w = wf('subsystems', 'sub.motion');
  const from = w.connections['Generate Keyframes'].main[0].map((e) => e.node).sort();
  eq(from, ['Generate Captions', 'Generate Clips', 'Generate Voiceover'], 'fan-out');
  for (const n of ['Generate Clips', 'Generate Voiceover', 'Generate Captions']) {
    eq(w.connections[n].main[0].map((e) => e.node), ['Gather Media'], `${n} rejoin`);
  }
});

test('compiler: a conditional call is gated, not branched', () => {
  const w = wf('system', 'sys.orchestrator');
  const names = nodeNames(w);
  for (const f of ['Content Factory', 'Visual Factory', 'Motion Factory']) {
    ok(names.includes(`${f} · Applies?`), `${f} should be gated`);
  }
  const dispatch = w.connections['Dispatch Plan Nodes'].main[0].map((e) => e.node).sort();
  eq(dispatch, ['Content Factory · Applies?', 'Motion Factory · Applies?', 'Visual Factory · Applies?']);
});

test('compiler: an agent step wires model, memory, tools and parser as sub-nodes', () => {
  const w = wf('terminal', 'copy.longform.generate');
  const c = w.connections;
  ok(c['Long-form Writer · Model'].ai_languageModel, 'model attached');
  ok(c['Long-form Writer · Schema'].ai_outputParser, 'parser attached');
  ok(c['Tool · research.web.search'].ai_tool, 'tool attached');
});

test('compiler: every connection target exists and nothing overlaps on canvas', () => {
  for (const [id, spec] of specs) {
    const w = wf(spec._layer, id);
    const names = new Set(w.nodes.map((n) => n.name));
    for (const [from, conn] of Object.entries(w.connections)) {
      ok(names.has(from), `${id}: dangling source ${from}`);
      for (const slots of Object.values(conn)) for (const slot of slots ?? []) for (const e of slot ?? []) {
        ok(names.has(e.node), `${id}: dangling target ${e.node}`);
      }
    }
    const ns = w.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const dx = Math.abs(ns[i].position[0] - ns[j].position[0]);
      const dy = Math.abs(ns[i].position[1] - ns[j].position[1]);
      ok(!(dx < 200 && dy < 110), `${id}: "${ns[i].name}" overlaps "${ns[j].name}"`);
    }
  }
});

test('compiler: workflow metadata carries the capability contract', () => {
  const w = wf('terminal', 'dist.publish.linkedin');
  eq(w.meta.mos.capability_id, 'dist.publish.linkedin');
  eq(w.meta.mos.side_effects, 'publish');
  eq(w.meta.mos.compensation, 'dist.unpublish.linkedin');
  ok(w.tags.some((t) => t.name === 'mos:terminal'));
});

// ───────────────────────────────────────────────────── generated runtime behaviour
test('runtime: the envelope guard rejects an unsupported major version', () => {
  const w = wf('terminal', 'media.captions.generate');
  const src = w.nodes.find((n) => n.name === 'Envelope In').parameters.jsCode;
  let threw = null;
  try { runCode(src, { json: { envelope_version: '2.0.0', trace_id: 't', tenant_id: 'x', idempotency_key: 'k' } }); }
  catch (e) { threw = e.message; }
  ok(threw?.includes('VALIDATION_FAILED'), `expected a version rejection, got ${threw}`);
});

test('runtime: the envelope guard fails fast on an already-passed deadline', () => {
  const w = wf('terminal', 'media.captions.generate');
  const src = w.nodes.find((n) => n.name === 'Envelope In').parameters.jsCode;
  let threw = null;
  try { runCode(src, { json: { envelope_version: '1.0.0', trace_id: 't', tenant_id: 'x', idempotency_key: 'k', deadline_at: '2020-01-01T00:00:00Z' } }); }
  catch (e) { threw = e.message; }
  ok(threw?.includes('TIMEOUT'), `expected a deadline rejection, got ${threw}`);
});

test('runtime: the budget guard blocks a spend that would exceed the cap', () => {
  const w = wf('terminal', 'media.image.generate');
  const src = w.nodes.find((n) => n.name === 'Budget Guard').parameters.jsCode;
  let threw = null;
  try { runCode(src, { json: { budget: { cap_minor_units: 2, spent_minor_units: 0 }, policy: {} } }); }
  catch (e) { threw = e.message; }
  ok(threw?.includes('BUDGET_EXCEEDED'), `expected BUDGET_EXCEEDED, got ${threw}`);
});

test('runtime: the budget guard downgrades the model tier at the soft limit', () => {
  const w = wf('terminal', 'media.image.generate');
  const src = w.nodes.find((n) => n.name === 'Budget Guard').parameters.jsCode;
  // cap 20, spent 14, estimate 4 -> 18 is past the 0.8 soft limit but inside the hard cap.
  const out = runCode(src, { json: { budget: { cap_minor_units: 20, spent_minor_units: 14, soft_limit_pct: 0.8 }, policy: { model_tier_cap: 'frontier' } } });
  eq(out[0].json.policy.model_tier_cap, 'standard');
});

test('runtime: the publish gate fails closed when a check was never evaluated', () => {
  const w = wf('terminal', 'dist.publish.telegram');
  const src = w.nodes.find((n) => n.name === 'Re-verify Gates').parameters.jsCode;
  const out = runCode(src, { json: { gates: { compliance: 'pass' } }, nodes: { 'Envelope In': { payload: { gates: { compliance: 'pass' } } } } });
  eq(out[0].json.gate_pass, false, 'missing gates must not pass');
  ok(out[0].json.gate_failures.some((f) => f.reason === 'not_evaluated'));
});

test('runtime: the publish gate passes on a fully cleared item', () => {
  const w = wf('terminal', 'dist.publish.telegram');
  const src = w.nodes.find((n) => n.name === 'Re-verify Gates').parameters.jsCode;
  const gates = { compliance: 'pass', brand: 'pass', rights: 'pass', approval: 'approved' };
  const out = runCode(src, { json: { gates }, nodes: { 'Envelope In': { payload: { gates } } } });
  eq(out[0].json.gate_pass, true);
});

test('runtime: short-copy enforcement truncates hashtags and rejects banned terms', () => {
  const w = wf('terminal', 'copy.short.generate');
  const src = w.nodes.find((n) => n.name === 'Enforce Limits').parameters.jsCode;
  const slot = { limits: { max_chars: 60, hashtags_max: 2 }, profile: { message: { lexicon: { banned: ['guaranteed results'] } } } };
  const out = runCode(src, {
    json: { output: { variants: [
      { hook: 'Short and clean', body: 'Fits fine.', hashtags: ['a', 'b', 'c', 'd'] },
      { hook: 'Bad one', body: 'We offer guaranteed results for everyone.', hashtags: [] },
    ] } },
    nodes: { 'Resolve Slot Spec': slot },
  });
  eq(out[0].json.usable, 1, 'one clean variant');
  eq(out[0].json.variants[0].hashtags.length, 2, 'hashtags capped');
  ok(out[0].json.rejected[0].issues.some((i) => i.startsWith('banned_term')), 'banned term rejected');
});

test('runtime: the DAM reuse decision respects the vertical reuse bias', () => {
  const w = wf('terminal', 'media.image.search');
  const src = w.nodes.find((n) => n.name === 'Reuse or Generate').parameters.jsCode;
  const results = [{ asset_id: 'a1', similarity: 0.82, used_count: 0 }];
  const lowBias = runCode(src, { json: { results }, nodes: { 'Envelope In': { payload: { profile: { creative: { asset_reuse_bias: 0.1 } } } } } });
  eq(lowBias[0].json.decision, 'generate', 'a low reuse bias should demand a closer match');
  const highBias = runCode(src, { json: { results }, nodes: { 'Envelope In': { payload: { profile: { creative: { asset_reuse_bias: 0.9 } } } } } });
  eq(highBias[0].json.decision, 'reuse', 'a high reuse bias should accept it');
});

test('runtime: a fatigued asset is excluded from reuse even when it matches', () => {
  const w = wf('terminal', 'media.image.search');
  const src = w.nodes.find((n) => n.name === 'Reuse or Generate').parameters.jsCode;
  const out = runCode(src, {
    json: { results: [{ asset_id: 'a1', similarity: 0.99, used_count: 5, days_since_last_use: 3 }] },
    nodes: { 'Envelope In': { payload: { profile: { creative: { asset_reuse_bias: 0.9 } } } } },
  });
  eq(out[0].json.decision, 'generate');
  eq(out[0].json.fatigued_excluded, 1);
});

test('runtime: creative scoring shrinks a thin sample toward neutral', () => {
  const w = wf('terminal', 'measure.creative.score');
  const src = w.nodes.find((n) => n.name === 'Compute Score').parameters.jsCode;
  const profile = { kpis: [{ metric: 'click_through_rate', primary: true, benchmark: 0.015 }] };
  const out = runCode(src, {
    json: profile,
    nodes: { 'Envelope In': { payload: { metrics: [
      { channel: 'linkedin', ctr: 0.03, impressions: 10 },
      { channel: 'blog', ctr: 0.03, impressions: 3000 },
    ] } } },
  });
  const thin = out[0].json.scored.find((s) => s.channel === 'linkedin');
  const solid = out[0].json.scored.find((s) => s.channel === 'blog');
  ok(thin.score < solid.score, 'a 10-impression result must not outrank a 3000-impression one');
  eq(thin.decisive, false);
  eq(solid.decisive, true);
});

test('runtime: learning refuses out-of-scope and under-powered proposals', () => {
  const w = wf('terminal', 'learn.playbook.update');
  const src = w.nodes.find((n) => n.name === 'Reject Out-of-Scope Proposals').parameters.jsCode;
  const out = runCode(src, { json: { output: { proposals: [
    { path: 'channels.weights.linkedin', from: 0.3, to: 0.35, evidence: 'x', sample_size: 40 },
    { path: 'compliance.review_mode', from: 'always', to: 'none', evidence: 'x', sample_size: 99 },
    { path: 'channels.weights.blog', from: 0.2, to: 0.3, evidence: 'x', sample_size: 4 },
  ] } } });
  eq(out[0].json.proposals.length, 1, 'only the well-evidenced in-scope proposal survives');
  eq(out[0].json.rejected.map((r) => r.reason).sort(), ['insufficient_sample', 'out_of_scope_for_automated_learning']);
});

test('runtime: the video timeline degrades a missing clip to its still frame', () => {
  const w = wf('terminal', 'media.video.render');
  const src = w.nodes.find((n) => n.name === 'Build Timeline').parameters.jsCode;
  const out = runCode(src, { json: { payload: {
    aspect_ratio: '9:16',
    beats: [{ duration_s: 3 }, { duration_s: 3 }],
    clips: [{ beat_index: 0, uri: 'clip0.mp4' }],
    stills: [{ beat_index: 1, uri: 'still1.png' }],
    cues: [], voiceover_uri: 'vo.mp3',
  } } });
  eq(out[0].json.degraded_beats, 1);
  eq(out[0].json.elements[1].type, 'image', 'the missing beat became a still');
  ok(out[0].json.elements[1].animations.length, 'the still gets a slow push so the cut still breathes');
  eq(out[0].json.total_duration_s, 6);
});

test('runtime: a before/after proof render refuses generated evidence', () => {
  const w = wf('terminal', 'media.video.render.before_after');
  const src = w.nodes.find((n) => n.name === 'Build Timeline').parameters.jsCode;
  let threw = null;
  try { runCode(src, { json: { payload: { evidence_pair: { generated: true }, beats: [], clips: [], stills: [] } } }); }
  catch (e) { threw = e.message; }
  ok(threw?.includes('COMPLIANCE_BLOCKED'), `expected a compliance block, got ${threw}`);
});

test('runtime: the compliance screen blocks a missing mandatory disclaimer', () => {
  const w = wf('terminal', 'verify.compliance.screen');
  const src = w.nodes.find((n) => n.name === 'Deterministic Rules').parameters.jsCode;
  const profile = registry.compliance.profiles.regulated_health;
  const out = runCode(src, {
    json: { ...profile, required_disclaimers: profile.required_disclaimers },
    nodes: { 'Envelope In': { payload: { body: 'Our supplement cures diabetes in weeks.', banned_terms: [] } } },
  });
  const f = out[0].json.deterministic_findings;
  ok(f.some((x) => x.test === 'disease_claim'), 'disease claim caught');
  ok(f.some((x) => x.test === 'missing_disclaimer'), 'missing disclaimer caught');
  ok(f.every((x) => x.severity === 'block'), 'both are blocking');
});

test('runtime: the compliance screen passes clean copy under the standard profile', () => {
  const w = wf('terminal', 'verify.compliance.screen');
  const src = w.nodes.find((n) => n.name === 'Deterministic Rules').parameters.jsCode;
  const out = runCode(src, {
    json: registry.compliance.profiles.standard,
    nodes: { 'Envelope In': { payload: { body: 'We install heat pumps in Denton. Most jobs finish the same day.', banned_terms: [] } } },
  });
  eq(out[0].json.deterministic_findings.length, 0);
});

test('runtime: intake normalisation handles a Telegram voice note', () => {
  const w = wf('terminal', 'intake.message.normalize');
  const src = w.nodes.find((n) => n.name === 'Detect Source Shape').parameters.jsCode;
  const out = runCode(src, { json: { payload: { source_channel: 'telegram', raw: { message: { message_id: 9, from: { id: 42 }, voice: { file_id: 'f1', duration: 12 } } } } } });
  eq(out[0].json.modality, 'voice');
  eq(out[0].json.needs_transcription, true);
  eq(out[0].json.source.author, '42');
});

test('runtime: PII is redacted before any text reaches a model', () => {
  const w = wf('terminal', 'intake.message.normalize');
  const src = w.nodes.find((n) => n.name === 'Redact PII').parameters.jsCode;
  const out = runCode(src, {
    json: { text: 'Call me on +1 940 555 0123 or dana@example.com' },
    nodes: { 'Envelope In': { policy: { pii_redaction: true } } },
  });
  ok(!out[0].json.text.includes('example.com'), 'email redacted');
  ok(!out[0].json.text.includes('555'), 'phone redacted');
  eq(out[0].json.pii_redactions, 2);
});

// ───────────────────────────────────────────────────────────── contract coverage
test('contracts: every declared JSON Schema parses and has an $id', () => {
  const dir = path.join(ROOT, 'contracts');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    ok(s.$id, `${f} has no $id`);
    ok(s.title, `${f} has no title`);
  }
});

test('contracts: every play in every vertical is executable end to end', () => {
  for (const [vid, v] of Object.entries(registry.verticalsResolved)) {
    for (const play of v.plays ?? []) {
      for (const step of play.steps) {
        ok(registry.routing.defaults[step.tag], `${vid}/${play.id}: tag "${step.tag}" has no default`);
      }
    }
  }
});

// ───────────────────────────────────────────────────────────────────── report
for (const f of failures) console.log(`FAIL  ${f.name}\n      ${f.message}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
