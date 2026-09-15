#!/usr/bin/env node
/**
 * Estate integrity checks.
 *
 * The premise: in an automation estate the expensive failures are not bad code, they are
 * BROKEN REFERENCES — a router pointing at a workflow nobody built, a side-effecting step
 * with no rollback, a vertical binding to a typo. Those fail at 3am in production on a
 * customer's account. Every one of them is statically detectable, so every one of them is
 * checked here and turns the build red instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSpecs, loadRegistry, ROOT } from '../compiler/load.mjs';

const findings = [];
const add = (severity, check, message, where) => findings.push({ severity, check, message, where });
const err = (...a) => add('error', ...a);
const warn = (...a) => add('warn', ...a);

const specs = loadSpecs();
const registry = loadRegistry();
const ids = new Set(specs.keys());
const roadmapIds = new Set((registry.roadmap.planned ?? []).map((r) => r.id));
const uncompensable = new Set((registry.roadmap.uncompensable ?? []).map((r) => r.id));
const known = (id) => ids.has(id) || roadmapIds.has(id);

// ---------------------------------------------------------------- capability manifests
const REQUIRED = ['id', 'version', 'layer', 'title', 'capability_tags', 'side_effects', 'idempotent'];
const SIDE_EFFECTS = ['none', 'internal_write', 'external_write', 'publish', 'spend'];
const LAYERS = ['terminal', 'subsystem', 'system'];

for (const [id, spec] of specs) {
  const c = spec.capability;
  const where = path.relative(ROOT, spec._file);
  for (const f of REQUIRED) if (c[f] === undefined) err('manifest.required', `missing capability.${f}`, where);
  if (!LAYERS.includes(c.layer)) err('manifest.layer', `layer "${c.layer}" is not one of ${LAYERS.join('/')}`, where);
  if (!SIDE_EFFECTS.includes(c.side_effects)) err('manifest.side_effects', `side_effects "${c.side_effects}" is not valid`, where);
  if (!/^\d+\.\d+\.\d+$/.test(c.version ?? '')) err('manifest.version', `version "${c.version}" is not semver`, where);
  if (!/^[a-z0-9]+(\.[a-z0-9_]+)+$/.test(id)) err('manifest.id', `id "${id}" is not dotted-lowercase`, where);
  if (!Array.isArray(c.capability_tags) || !c.capability_tags.length) err('manifest.tags', 'capability_tags must be a non-empty array', where);
  if (c.maturity === 'ga' && !c.owner) err('manifest.owner', 'a GA capability must name an owner', where);

  // The rule that keeps an autonomous system reversible. It binds at the TERMINAL layer:
  // subsystems and the orchestrator do not carry their own rollback, they walk the
  // provenance array and invoke the terminals' compensations in reverse. A compensation
  // capability is itself exempt — compensating a rollback is not a thing.
  const isCompensation = (c.capability_tags ?? []).some((t) => t.startsWith('compensate.'));
  if (c.layer === 'terminal' && !isCompensation && ['external_write', 'publish'].includes(c.side_effects) && !c.compensation && !uncompensable.has(id)) {
    err('saga.compensation', `side_effects "${c.side_effects}" with no compensation and not declared uncompensable in registry/roadmap.json`, where);
  }
  if (c.compensation && !known(c.compensation)) err('saga.dangling', `compensation "${c.compensation}" does not exist`, where);
  if (['publish', 'spend'].includes(c.side_effects) && c.idempotent !== true) {
    err('saga.idempotency', `side_effects "${c.side_effects}" must be idempotent — a retry would otherwise double-post or double-charge`, where);
  }

  for (const dep of c.requires?.capabilities ?? []) {
    if (!known(dep)) err('deps.dangling', `requires.capabilities -> "${dep}" does not exist`, where);
  }

  // ------------------------------------------------------------------- step graph
  const stepIds = new Set();
  for (const step of spec.n8n.nodes ?? []) {
    if (stepIds.has(step.id)) err('spec.duplicate_step', `duplicate step id "${step.id}"`, where);
    stepIds.add(step.id);
    if (!step.title) err('spec.title', `step "${step.id}" has no title (titles become n8n node names)`, where);
  }
  for (const step of spec.n8n.nodes ?? []) {
    const targets = typeof step.next === 'string' ? [step.next] : (step.next && typeof step.next === 'object' ? Object.values(step.next) : []);
    for (const t of targets) if (t !== null && !stepIds.has(t)) err('spec.next', `step "${step.id}".next -> "${t}" is not a step in this spec`, where);
    if (String(step.onError ?? '').startsWith('route:')) {
      const t = String(step.onError).slice(6);
      if (!stepIds.has(t)) err('spec.onError', `step "${step.id}".onError -> "${t}" is not a step in this spec`, where);
    }
    if (step.kind === 'call') {
      const target = step.with?.capability ?? '';
      if (!target.startsWith('=') && !known(target)) err('call.dangling', `step "${step.id}" calls "${target}" which does not exist`, where);
      if (target === id) err('call.self', `step "${step.id}" calls its own capability`, where);
    }
    if (step.kind === 'route') {
      const tag = step.with?.tag;
      if (!registry.routing.defaults?.[tag]) err('route.no_default', `step "${step.id}" routes tag "${tag}" which has no entry in routing.defaults — resolution would fail at runtime`, where);
    }
    if (['llm', 'agent'].includes(step.kind)) {
      const role = step.with?.role;
      if (role && !registry.models.roles[role]) err('model.role', `step "${step.id}" uses model role "${role}" which is not in registry/models.json`, where);
      for (const tool of step.with?.tools ?? []) if (!known(tool)) err('tool.dangling', `step "${step.id}" exposes tool "${tool}" which does not exist`, where);
    }
  }
}

// ------------------------------------------------- implicit fall-through hazard
// A step with no explicit `next` falls through to whatever comes next in the array. When
// that successor is also the explicit target of an earlier branch, the fall-through is
// almost always unintended — it silently re-enters a terminal path. Caught statically here
// because it produces a workflow that looks right and behaves wrong.
for (const [id, spec] of specs) {
  const where = path.relative(ROOT, spec._file);
  const stepsArr = spec.n8n.nodes ?? [];
  const branchTargets = new Set();
  for (const st of stepsArr) {
    const t = typeof st.next === 'string' ? [st.next] : (st.next && typeof st.next === 'object' ? Object.values(st.next) : []);
    for (const x of t) if (x) branchTargets.add(x);
  }
  for (let i = 0; i < stepsArr.length - 1; i++) {
    const st = stepsArr[i];
    if (st.next !== undefined) continue;
    const succ = stepsArr[i + 1];
    const sameGroup = (st.parallel_group ?? st.with?.parallel_group ?? null) &&
      (st.parallel_group ?? st.with?.parallel_group) === (succ.parallel_group ?? succ.with?.parallel_group);
    if (sameGroup) continue;
    if (branchTargets.has(succ.id)) {
      warn('spec.fallthrough', `step "${st.id}" has no explicit next and falls through to "${succ.id}", which is an explicit branch target elsewhere — add "next": null if that is not intended`, where);
    }
  }
}

// ---------------------------------------------------------------- dependency cycles
{
  const graph = new Map();
  for (const [id, spec] of specs) {
    const out = new Set(spec.capability.requires?.capabilities ?? []);
    for (const step of spec.n8n.nodes ?? []) {
      const t = step.with?.capability;
      if (step.kind === 'call' && typeof t === 'string' && !t.startsWith('=')) out.add(t);
    }
    graph.set(id, [...out].filter((x) => ids.has(x)));
  }
  const state = new Map();
  const stack = [];
  const visit = (n) => {
    if (state.get(n) === 'done') return;
    if (state.get(n) === 'open') {
      err('deps.cycle', `capability dependency cycle: ${[...stack.slice(stack.indexOf(n)), n].join(' -> ')}`, 'specs/');
      return;
    }
    state.set(n, 'open');
    stack.push(n);
    for (const m of graph.get(n) ?? []) visit(m);
    stack.pop();
    state.set(n, 'done');
  };
  for (const n of graph.keys()) visit(n);
}

// ---------------------------------------------------------------- routing policy
{
  const where = 'registry/policies/routing.json';
  const implementedTags = new Set();
  for (const spec of specs.values()) for (const t of spec.capability.capability_tags ?? []) implementedTags.add(t);

  for (const [tag, capId] of Object.entries(registry.routing.defaults ?? {})) {
    if (!known(capId)) err('routing.default_dangling', `defaults["${tag}"] -> "${capId}" does not exist`, where);
    else if (!ids.has(capId)) warn('routing.default_planned', `defaults["${tag}"] -> "${capId}" is only on the roadmap; this tag has no runnable implementation yet`, where);
  }
  for (const row of registry.routing.policy_table ?? []) {
    if (!known(row.bind)) err('routing.bind_dangling', `policy_table ${row.tag} -> "${row.bind}" does not exist`, where);
    else if (!ids.has(row.bind)) warn('routing.bind_planned', `policy_table ${row.tag} -> "${row.bind}" is a roadmap item`, where);
    if (!registry.routing.defaults?.[row.tag]) err('routing.table_no_default', `policy_table names tag "${row.tag}" which has no default`, where);
  }
  for (const rule of registry.routing.hard_rules ?? []) {
    if (rule.then?.capability && !known(rule.then.capability)) err('routing.rule_dangling', `hard rule ${rule.id} binds "${rule.then.capability}" which does not exist`, where);
    for (const cond of Object.values(rule.when ?? {})) {
      for (const [op, val] of Object.entries(cond)) {
        if (op !== 'matches') continue;
        // A hard rule whose regex does not compile silently never fires — the worst possible
        // failure mode for a compliance gate. Compile it here so it cannot ship broken.
        const m = /^\(\?([imsux]+)\)/.exec(String(val));
        try { new RegExp(m ? String(val).slice(m[0].length) : String(val), m ? m[1].replace(/[xu]/g, '') : ''); }
        catch (e) { err('routing.bad_regex', `hard rule ${rule.id} has an invalid regex: ${e.message}`, where); }
      }
    }
  }
  for (const tag of Object.keys(registry.routing.defaults ?? {})) {
    if (!implementedTags.has(tag) && !(registry.roadmap.planned ?? []).some((r) => r.tag === tag)) {
      warn('routing.tag_unimplemented', `tag "${tag}" has a default but no spec declares it in capability_tags`, where);
    }
  }
}

// ---------------------------------------------------------------- vertical profiles
for (const [vid, v] of Object.entries(registry.verticals)) {
  const where = `registry/verticals/${vid}.json`;
  if (v.extends && !registry.verticals[v.extends]) err('vertical.extends', `extends "${v.extends}" which does not exist`, where);
  for (const [tag, capId] of Object.entries(v.capability_bindings ?? {})) {
    if (!known(capId)) err('vertical.binding_dangling', `capability_bindings["${tag}"] -> "${capId}" does not exist`, where);
    else if (!ids.has(capId)) warn('vertical.binding_planned', `capability_bindings["${tag}"] -> "${capId}" is a roadmap item; runs will fall through to the default`, where);
    if (!registry.routing.defaults?.[tag]) warn('vertical.binding_unknown_tag', `capability_bindings names tag "${tag}" which has no routing default`, where);
  }
  const resolved = registry.verticalsResolved[vid];
  const profile = resolved.compliance?.profile;
  if (profile && !registry.compliance.profiles[profile]) err('vertical.compliance', `compliance.profile "${profile}" is not defined in registry/policies/compliance.json`, where);
  for (const ch of Object.keys(resolved.channels?.weights ?? {})) {
    if (!registry.channels.channels[ch]) err('vertical.channel', `channels.weights names "${ch}" which is not in registry/channels.json`, where);
  }
  for (const [ch, formats] of Object.entries(resolved.channels?.formats ?? {})) {
    const def = registry.channels.channels[ch];
    if (!def) { err('vertical.channel', `channels.formats names "${ch}" which is not in registry/channels.json`, where); continue; }
    for (const f of formats) if (!def.formats?.[f]) err('vertical.format', `channel "${ch}" has no format "${f}"`, where);
  }
  const tagsInPlays = new Set((resolved.plays ?? []).flatMap((p) => p.steps.map((s) => s.tag)));
  for (const t of tagsInPlays) {
    if (!registry.routing.defaults?.[t]) err('vertical.play_tag', `a play uses tag "${t}" which has no routing default — the plan would not be executable`, where);
  }
}

// ---------------------------------------------------------------- channel adapters
for (const [ch, def] of Object.entries(registry.channels.channels)) {
  if (def.adapter && !known(def.adapter)) err('channel.adapter', `channel "${ch}" names adapter "${def.adapter}" which does not exist`, 'registry/channels.json');
  else if (def.adapter && !ids.has(def.adapter)) warn('channel.adapter_planned', `channel "${ch}" adapter "${def.adapter}" is a roadmap item`, 'registry/channels.json');
}

// ---------------------------------------------------------------- roadmap hygiene
for (const r of registry.roadmap.planned ?? []) {
  if (ids.has(r.id)) err('roadmap.stale', `"${r.id}" is listed as planned but a spec now exists — remove it from the roadmap`, 'registry/roadmap.json');
}
for (const r of registry.roadmap.uncompensable ?? []) {
  if (!ids.has(r.id)) warn('roadmap.uncompensable_unknown', `uncompensable entry "${r.id}" has no spec`, 'registry/roadmap.json');
  if (!r.rationale) err('roadmap.uncompensable_rationale', `uncompensable entry "${r.id}" must state a rationale`, 'registry/roadmap.json');
}

// ---------------------------------------------------------------- compiled output
{
  const distDir = path.join(ROOT, 'dist', 'n8n');
  if (!fs.existsSync(distDir)) {
    warn('dist.missing', 'dist/n8n is absent — run `npm run build` before validating compiled output', 'dist/');
  } else {
    for (const layer of fs.readdirSync(distDir)) {
      for (const file of fs.readdirSync(path.join(distDir, layer))) {
        const rel = `dist/n8n/${layer}/${file}`;
        const wf = JSON.parse(fs.readFileSync(path.join(distDir, layer, file), 'utf8'));
        const names = new Set(wf.nodes.map((n) => n.name));
        for (const [from, conn] of Object.entries(wf.connections)) {
          if (!names.has(from)) err('dist.connection_source', `connection from unknown node "${from}"`, rel);
          for (const slots of Object.values(conn)) {
            for (const slot of slots ?? []) for (const e of slot ?? []) {
              if (!names.has(e.node)) err('dist.connection_target', `connection "${from}" -> unknown node "${e.node}"`, rel);
            }
          }
        }
        const positioned = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
        for (let i = 0; i < positioned.length; i++) {
          for (let j = i + 1; j < positioned.length; j++) {
            const dx = Math.abs(positioned[i].position[0] - positioned[j].position[0]);
            const dy = Math.abs(positioned[i].position[1] - positioned[j].position[1]);
            if (dx < 200 && dy < 110) warn('dist.overlap', `nodes overlap on the canvas: "${positioned[i].name}" and "${positioned[j].name}"`, rel);
          }
        }
        const TRIGGER_TYPES = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.manualTrigger', 'n8n-nodes-base.errorTrigger', 'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.telegramTrigger', 'n8n-nodes-base.executeWorkflowTrigger']);
        const unreachable = positioned.filter((n) => {
          if (n.type.endsWith('Trigger') || TRIGGER_TYPES.has(n.type) || n.type.startsWith('@n8n/')) return false;
          return !Object.values(wf.connections).some((c) => Object.values(c).some((slots) => (slots ?? []).some((slot) => (slot ?? []).some((e) => e.node === n.name))));
        });
        for (const n of unreachable) warn('dist.unreachable', `node "${n.name}" has no inbound connection`, rel);
      }
    }
  }
}

// ---------------------------------------------------------------- report
const errors = findings.filter((f) => f.severity === 'error');
const warns = findings.filter((f) => f.severity === 'warn');
const group = (list) => {
  const byCheck = {};
  for (const f of list) (byCheck[f.check] = byCheck[f.check] ?? []).push(f);
  return byCheck;
};

for (const [sev, list] of [['ERROR', errors], ['WARN', warns]]) {
  if (!list.length) continue;
  console.log(`\n${sev} (${list.length})`);
  for (const [check, items] of Object.entries(group(list))) {
    console.log(`  ${check}`);
    for (const f of items) console.log(`    ${f.where}: ${f.message}`);
  }
}

console.log(`\nchecked ${specs.size} capabilities, ${Object.keys(registry.verticals).length} verticals, ${Object.keys(registry.channels.channels).length} channels`);
console.log(`${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
