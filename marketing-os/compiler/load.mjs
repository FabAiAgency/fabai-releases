import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot parse ${path.relative(ROOT, p)}: ${err.message}`);
  }
}

export function listSpecFiles() {
  const out = [];
  for (const layer of ['terminal', 'subsystems', 'system']) {
    const dir = path.join(ROOT, 'specs', layer);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      out.push({ layer, file: path.join(dir, f) });
    }
  }
  return out;
}

/**
 * Deep merge used by both spec `extends` and vertical profile inheritance.
 * Objects merge key-wise; arrays REPLACE unless the key ends in `_add`, in which case
 * they concatenate. Replace-by-default is the safer rule: a child that lists three
 * channels means exactly three, not three plus whatever the parent had.
 */
export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = Array.isArray(base) ? [...base] : { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over)) {
    if (k.endsWith('_add') && Array.isArray(v)) {
      const target = k.slice(0, -4);
      out[target] = [...(out[target] ?? []), ...v];
      continue;
    }
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * Applies a specialisation spec's `overrides` onto the parent's node list.
 * Supported per-node keys: system_append, code_prepend, code_append, role_override,
 * template, extra_prompt_fields. Anything else is merged into the node's `with`.
 *
 * This is the mechanism that keeps a vertical specialisation to ~15 lines instead of
 * a forked copy of a 12-node workflow that then drifts.
 */
function applyOverrides(parentNodes, overrides) {
  return parentNodes.map((node) => {
    const ov = overrides?.[node.id];
    if (!ov) return node;
    const next = structuredClone(node);
    next.with = next.with ?? {};
    const { system_append, code_prepend, code_append, role_override, template, extra_prompt_fields, ...rest } = ov;
    if (system_append) next.with.system = (next.with.system ?? '') + system_append;
    if (code_prepend) next.with.code = code_prepend + (next.with.code ?? '');
    if (code_append) next.with.code = (next.with.code ?? '') + code_append;
    if (role_override) next.with.role = role_override;
    if (template) next.with.template = deepMerge(next.with.template ?? {}, template);
    if (extra_prompt_fields && next.with.structured?.properties) {
      const items = next.with.structured.properties.prompts?.items;
      if (items?.properties) Object.assign(items.properties, extra_prompt_fields);
    }
    next.with = deepMerge(next.with, rest);
    return next;
  });
}

export function loadSpecs() {
  const raw = new Map();
  for (const { layer, file } of listSpecFiles()) {
    const spec = readJson(file);
    const id = spec.capability?.id;
    if (!id) throw new Error(`${path.relative(ROOT, file)} has no capability.id`);
    if (raw.has(id)) throw new Error(`Duplicate capability id: ${id}`);
    raw.set(id, { ...spec, _file: file, _layer: layer });
  }

  // Resolve `extends` chains (specialisations of a base workflow).
  const resolved = new Map();
  const resolving = new Set();
  const resolve = (id) => {
    if (resolved.has(id)) return resolved.get(id);
    if (resolving.has(id)) throw new Error(`Circular spec extends chain at ${id}`);
    const spec = raw.get(id);
    if (!spec) throw new Error(`Spec extends unknown parent: ${id}`);
    if (!spec.extends) {
      resolved.set(id, spec);
      return spec;
    }
    resolving.add(id);
    const parent = resolve(spec.extends);
    resolving.delete(id);
    const merged = {
      ...spec,
      capability: deepMerge(structuredClone(parent.capability), spec.capability),
      n8n: {
        ...structuredClone(parent.n8n),
        nodes: applyOverrides(structuredClone(parent.n8n.nodes), spec.overrides),
      },
      _file: spec._file,
      _layer: spec._layer,
      _extends: spec.extends,
    };
    // A specialisation keeps its own id/title/summary, not the parent's.
    merged.capability.id = spec.capability.id;
    resolved.set(id, merged);
    return merged;
  };

  for (const id of raw.keys()) resolve(id);
  return resolved;
}

export function loadRegistry() {
  const reg = path.join(ROOT, 'registry');
  const verticalsDir = path.join(reg, 'verticals');
  const rawVerticals = Object.fromEntries(
    fs.readdirSync(verticalsDir).filter((f) => f.endsWith('.json'))
      .map((f) => { const v = readJson(path.join(verticalsDir, f)); return [v.id, v]; })
  );

  // Resolve profile inheritance once, at build time, so no runtime component ever has to.
  const resolvedVerticals = {};
  const resolveVertical = (id, seen = new Set()) => {
    if (resolvedVerticals[id]) return resolvedVerticals[id];
    if (seen.has(id)) throw new Error(`Circular vertical extends chain at ${id}`);
    const v = rawVerticals[id];
    if (!v) throw new Error(`Unknown vertical profile: ${id}`);
    seen.add(id);
    const out = v.extends ? deepMerge(structuredClone(resolveVertical(v.extends, seen)), v) : v;
    out.id = v.id;
    out.extends = v.extends ?? null;
    resolvedVerticals[id] = out;
    return out;
  };
  for (const id of Object.keys(rawVerticals)) resolveVertical(id);

  return {
    channels: readJson(path.join(reg, 'channels.json')),
    models: readJson(path.join(reg, 'models.json')),
    routing: readJson(path.join(reg, 'policies', 'routing.json')),
    compliance: readJson(path.join(reg, 'policies', 'compliance.json')),
    escalation: readJson(path.join(reg, 'policies', 'escalation.json')),
    roadmap: readJson(path.join(reg, 'roadmap.json')),
    verticals: rawVerticals,
    verticalsResolved: resolvedVerticals,
  };
}
