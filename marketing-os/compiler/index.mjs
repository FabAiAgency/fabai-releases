#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadSpecs, loadRegistry, ROOT } from './load.mjs';
import { compile } from './emit.mjs';

const OUT = path.join(ROOT, 'dist');

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

export function build({ quiet = false } = {}) {
  const specs = loadSpecs();
  const registry = loadRegistry();

  fs.rmSync(path.join(OUT, 'n8n'), { recursive: true, force: true });

  const manifest = {};
  let written = 0;
  for (const [id, spec] of specs) {
    const wf = compile(spec, registry);
    const file = path.join(OUT, 'n8n', spec._layer, `${id}.json`);
    if (writeIfChanged(file, JSON.stringify(wf, null, 2) + '\n')) written++;
    manifest[id] = {
      ...spec.capability,
      spec: path.relative(ROOT, spec._file),
      workflow: path.relative(ROOT, file),
      node_count: wf.nodes.length,
      extends: spec._extends ?? null,
    };
  }

  // The capability registry is DERIVED from specs, never hand-maintained. A registry that
  // can drift from the things it describes is worse than no registry.
  writeIfChanged(path.join(OUT, 'capabilities.json'), JSON.stringify({
    generated: true,
    note: 'Derived from specs/** by the compiler. Do not edit; edit the spec and rebuild.',
    version: '1.0.0',
    count: Object.keys(manifest).length,
    capabilities: manifest,
  }, null, 2) + '\n');

  // Resolved vertical profiles, inheritance already applied, for runtime consumption.
  writeIfChanged(path.join(OUT, 'verticals.resolved.json'), JSON.stringify({
    generated: true,
    note: 'Vertical profiles with their `extends` chains deep-merged at build time.',
    verticals: registry.verticalsResolved,
  }, null, 2) + '\n');

  // Flat env bundle the workflows read at runtime (MOS_CHANNELS, MOS_CAPABILITY_REGISTRY).
  writeIfChanged(path.join(OUT, 'runtime-env.json'), JSON.stringify({
    generated: true,
    note: 'Load these into the n8n environment. Workflows read them instead of embedding platform limits.',
    MOS_CHANNELS: registry.channels.channels,
    MOS_CAPABILITY_REGISTRY: Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, { side_effects: v.side_effects, compensation: v.compensation, idempotent: v.idempotent, cost: v.cost_model?.estimate_minor_units ?? 0 }])),
  }, null, 2) + '\n');

  const stats = {
    specs: specs.size,
    byLayer: [...specs.values()].reduce((a, s) => ({ ...a, [s._layer]: (a[s._layer] ?? 0) + 1 }), {}),
    nodes: Object.values(manifest).reduce((a, m) => a + m.node_count, 0),
    verticals: Object.keys(registry.verticalsResolved).length,
    changed: written,
  };
  if (!quiet) {
    console.log(`compiled ${stats.specs} specs -> dist/n8n  (${stats.changed} file(s) changed)`);
    console.log(`  terminal: ${stats.byLayer.terminal ?? 0}  subsystems: ${stats.byLayer.subsystems ?? 0}  system: ${stats.byLayer.system ?? 0}`);
    console.log(`  ${stats.nodes} n8n nodes across the estate, ${stats.verticals} vertical profiles resolved`);
  }
  return { manifest, registry, specs, stats };
}

if (process.argv[1] && process.argv[1].endsWith('index.mjs')) build();
