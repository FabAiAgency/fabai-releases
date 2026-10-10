import { buildResolverSource } from './router.mjs';

let uid = 0;
export const resetIds = () => { uid = 0; };
const id = (p) => `${p}_${String(++uid).padStart(4, '0')}`;

const T = {
  set: ['n8n-nodes-base.set', 3.4],
  code: ['n8n-nodes-base.code', 2],
  http: ['n8n-nodes-base.httpRequest', 4.2],
  if: ['n8n-nodes-base.if', 2.2],
  switch: ['n8n-nodes-base.switch', 3.2],
  splitOut: ['n8n-nodes-base.splitOut', 1],
  merge: ['n8n-nodes-base.merge', 3],
  wait: ['n8n-nodes-base.wait', 1.1],
  executeWorkflow: ['n8n-nodes-base.executeWorkflow', 1.2],
  telegram: ['n8n-nodes-base.telegram', 1.2],
  gdrive: ['n8n-nodes-base.googleDrive', 3],
  gsheets: ['n8n-nodes-base.googleSheets', 4.5],
  stop: ['n8n-nodes-base.stopAndError', 1],
  sticky: ['n8n-nodes-base.stickyNote', 1],
  noOp: ['n8n-nodes-base.noOp', 1],
  agent: ['@n8n/n8n-nodes-langchain.agent', 1.7],
  chainLlm: ['@n8n/n8n-nodes-langchain.chainLlm', 1.5],
  lmAnthropic: ['@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.2],
  lmOpenAi: ['@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.1],
  parser: ['@n8n/n8n-nodes-langchain.outputParserStructured', 1.2],
  memory: ['@n8n/n8n-nodes-langchain.memoryBufferWindow', 1.3],
  toolWorkflow: ['@n8n/n8n-nodes-langchain.toolWorkflow', 2],
  executeWorkflowTrigger: ['n8n-nodes-base.executeWorkflowTrigger', 1.1],
  telegramTrigger: ['n8n-nodes-base.telegramTrigger', 1.1],
  webhook: ['n8n-nodes-base.webhook', 2],
  schedule: ['n8n-nodes-base.scheduleTrigger', 1.2],
  errorTrigger: ['n8n-nodes-base.errorTrigger', 1],
  manual: ['n8n-nodes-base.manualTrigger', 1],
};

const mk = (kind, name, parameters, extra = {}) => ({
  id: id('n'),
  name,
  type: T[kind][0],
  typeVersion: T[kind][1],
  position: [0, 0],
  parameters,
  ...extra,
});

/** Model role -> concrete provider node, read from registry/models.json. */
function modelNode(role, models, name) {
  const chain = models.roles[role]?.chain ?? models.roles['copy.short'].chain;
  const head = chain[0];
  const cfg = models.roles[role] ?? {};
  const opts = {};
  if (cfg.temperature !== undefined) opts.temperature = cfg.temperature;
  if (cfg.max_output_tokens !== undefined) opts.maxTokens = cfg.max_output_tokens;
  if (head.provider === 'anthropic') {
    return mk('lmAnthropic', name, { model: { __rl: true, value: head.model, mode: 'list' }, options: opts });
  }
  return mk('lmOpenAi', name, { model: { __rl: true, value: head.model, mode: 'list' }, options: opts });
}

function condition(expr) {
  return {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: id('c'), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  };
}

/**
 * Every builder returns { nodes, connections, entry, exits }.
 *  entry  - node name inbound edges attach to
 *  exits  - { default: [names] } or branch-keyed outputs for if/switch
 */
const BUILD = {
  set(step) {
    const a = Object.entries(step.with?.assignments ?? {}).map(([k, v]) => ({
      id: id('a'), name: k, value: v, type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : Array.isArray(v) || (v && typeof v === 'object') ? 'object' : 'string',
    }));
    const n = mk('set', step.title, { mode: 'manual', includeOtherFields: true, assignments: { assignments: a } });
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  code(step) {
    const n = mk('code', step.title, {
      mode: step.with?.runOnceForAllItems === false ? 'runOnceForEachItem' : 'runOnceForAllItems',
      jsCode: step.with?.code ?? 'return items;',
    });
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  http(step, ctx) {
    const w = step.with ?? {};
    const retry = ctx.capability.retry ?? {};
    const params = {
      method: w.method ?? 'GET',
      url: w.url,
      options: {
        timeout: w.timeout_ms ?? ctx.capability.sla?.timeout_ms ?? 30000,
        ...(w.response === 'file' ? { response: { response: { responseFormat: 'file' } } } : {}),
      },
    };
    if (w.auth) { params.authentication = 'predefinedCredentialType'; params.nodeCredentialType = w.auth; }
    if (w.headers) { params.sendHeaders = true; params.specifyHeaders = 'json'; params.jsonHeaders = JSON.stringify(w.headers); }
    if (w.body) {
      params.sendBody = true;
      params.contentType = w.contentType ?? 'json';
      if (params.contentType === 'json') { params.specifyBody = 'json'; params.jsonBody = JSON.stringify(w.body, null, 2); }
      else { params.bodyParameters = { parameters: Object.entries(w.body).map(([k, v]) => ({ name: k, value: v })) }; }
      if (w.binaryField) { params.sendBinaryData = true; params.binaryPropertyName = w.binaryField; }
    }
    // Retry and timeout come from the capability manifest, never from the canvas. One
    // declaration, applied identically to every HTTP call in the estate.
    const n = mk('http', step.title, params, {
      retryOnFail: (retry.max_attempts ?? 3) > 1,
      maxTries: Math.min(5, retry.max_attempts ?? 3),
      waitBetweenTries: retry.base_ms ?? 2000,
      ...(step.onError === 'continue' ? { onError: 'continueRegularOutput' } : {}),
      ...(String(step.onError ?? '').startsWith('route:') ? { onError: 'continueErrorOutput' } : {}),
    });
    const exits = { default: [n.name, 0] };
    if (String(step.onError ?? '').startsWith('route:')) exits._error = [n.name, 1];
    return { nodes: [n], connections: {}, entry: n.name, exits };
  },

  if(step) {
    const n = mk('if', step.title, { conditions: condition(step.with?.condition ?? '={{ true }}'), looseTypeValidation: true, options: {} });
    return { nodes: [n], connections: {}, entry: n.name, exits: { true: [n.name, 0], false: [n.name, 1] } };
  },

  switch(step) {
    const cases = step.with?.cases ?? [];
    const n = mk('switch', step.title, {
      rules: { values: cases.map((c) => ({ conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, conditions: [{ id: id('c'), leftValue: step.with.value, rightValue: c, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, outputKey: c })) },
      options: { fallbackOutput: 'extra', renameFallbackOutput: step.with?.fallback ?? 'other' },
    });
    const exits = Object.fromEntries(cases.map((c, i) => [c, [n.name, i]]));
    exits.default = [n.name, 0];
    exits._fallback = [n.name, cases.length];
    return { nodes: [n], connections: {}, entry: n.name, exits };
  },

  splitOut(step) {
    const n = mk('splitOut', step.title, { fieldToSplitOut: step.with?.field ?? 'items', options: {} });
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  merge(step) {
    const n = mk('merge', step.title, { mode: step.with?.mode === 'append' ? 'append' : 'combine', combineBy: 'combineAll', numberInputs: step.with?.inputs ?? 2, options: {} });
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  wait(step) {
    const w = step.with ?? {};
    const params = w.resume === 'webhook'
      ? { resume: 'webhook', options: { webhookSuffix: '', limitWaitTime: true, resumeAmount: w.timeout_hours ?? 24, resumeUnit: 'hours' } }
      : { amount: w.seconds ?? 10, unit: 'seconds' };
    const n = mk('wait', step.title, params, w.resume === 'webhook' ? { webhookId: id('wh') } : {});
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  call(step) {
    const w = step.with ?? {};
    const n = mk('executeWorkflow', step.title, {
      workflowId: { __rl: true, value: w.capability, mode: 'id', cachedResultName: w.capability },
      mode: w.mode === 'each' ? 'each' : 'once',
      workflowInputs: { mappingMode: 'defineBelow', value: { envelope: '={{ $json }}' } },
      options: { waitForSubWorkflow: true },
    }, step.onError === 'continue' ? { onError: 'continueRegularOutput' } : {});
    // A conditional call is gated rather than branched: the dispatcher emits one item per
    // subsystem and each call takes only the items addressed to it. This is what lets the
    // orchestrator fan out to three factories from one dispatch node.
    if (w.when) {
      const gate = mk('if', `${step.title} · Applies?`, { conditions: condition(w.when), looseTypeValidation: true, options: {} });
      return {
        nodes: [gate, n],
        connections: { [gate.name]: { main: [[{ node: n.name, type: 'main', index: 0 }], []] } },
        entry: gate.name,
        exits: { default: [n.name] },
      };
    }
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  route(step, ctx) {
    const n = mk('code', step.title, {
      mode: 'runOnceForAllItems',
      jsCode: buildResolverSource({ tag: step.with.tag, routing: ctx.registry.routing, verticals: ctx.registry.verticalsResolved }),
    });
    const rec = mk('http', `${step.title} · Record Decision`, {
      method: 'POST', url: '={{ $env.MOS_STATE_URL }}/decisions',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'headerAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.decision) }}',
      options: { timeout: 5000 },
    }, { onError: 'continueRegularOutput' });
    return {
      nodes: [n, rec],
      connections: { [n.name]: { main: [[{ node: rec.name, type: 'main', index: 0 }]] } },
      entry: n.name,
      exits: { default: [rec.name] },
    };
  },

  guard(step) {
    const checks = step.with?.checks ?? ['compliance'];
    const check = mk('code', step.title, {
      mode: 'runOnceForAllItems',
      jsCode: `// GENERATED gate. Re-verifies what an upstream subsystem already checked.
// Cheap, and it makes a mis-wired caller fail CLOSED rather than publish.
const CHECKS = ${JSON.stringify(checks)};
const env = $('Envelope In').first().json;
const gates = { ...(env.payload?.gates ?? {}), ...($json.gates ?? {}) };
const PASS = { compliance: ['pass', 'warn'], brand: ['pass', 'warn'], rights: ['pass'], approval: ['approved', 'not_required'] };
const failed = [];
for (const c of CHECKS) {
  const v = gates[c] ?? (c === 'approval' ? gates.human_approval : undefined);
  if (v === undefined) { failed.push({ check: c, reason: 'not_evaluated' }); continue; }
  if (!(PASS[c] ?? ['pass']).includes(v)) failed.push({ check: c, reason: 'status_' + v });
}
return [{ json: { ...$json, gate_pass: failed.length === 0, gate_failures: failed } }];`,
    });
    const gate = mk('if', `${step.title} · Pass?`, { conditions: condition('={{ $json.gate_pass === true }}'), looseTypeValidation: true, options: {} });
    const stop = mk('stop', `${step.title} · Blocked`, { errorMessage: '=POLICY_BLOCKED: {{ JSON.stringify($json.gate_failures) }}' });
    return {
      nodes: [check, gate, stop],
      connections: {
        [check.name]: { main: [[{ node: gate.name, type: 'main', index: 0 }]] },
        [gate.name]: { main: [[], [{ node: stop.name, type: 'main', index: 0 }]] },
      },
      entry: check.name,
      exits: { default: [gate.name, 0] },
    };
  },

  emit(step, ctx) {
    const n = mk('code', step.title, {
      mode: 'runOnceForAllItems',
      jsCode: `// GENERATED telemetry emit.
const env = $('Envelope In').first().json;
return [{ json: { ...$json, _telemetry: {
  event_id: 'evt_' + Math.random().toString(36).slice(2, 12),
  trace_id: env.trace_id, span_id: env.span_id, tenant_id: env.tenant_id,
  vertical: env.vertical, capability: ${JSON.stringify(ctx.capability.id)},
  capability_version: ${JSON.stringify(ctx.capability.version)}, layer: ${JSON.stringify(ctx.capability.layer)},
  event: ${JSON.stringify(step.with?.event ?? 'span_end')}, status: ${JSON.stringify(step.with?.status ?? 'ok')},
  decision_id: $json.decision?.decision_id ?? null, at: new Date().toISOString()
} } }];`,
    });
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  llm(step, ctx) {
    const w = step.with ?? {};
    const main = mk('chainLlm', step.title, {
      promptType: 'define',
      text: w.prompt ?? '={{ $json.text }}',
      messages: { messageValues: [{ message: w.system ?? '' }] },
      hasOutputParser: !!w.structured,
    });
    const model = modelNode(w.role ?? 'copy.short', ctx.registry.models, `${step.title} · Model`);
    const nodes = [main, model];
    const connections = { [model.name]: { ai_languageModel: [[{ node: main.name, type: 'ai_languageModel', index: 0 }]] } };
    if (w.structured) {
      const parser = mk('parser', `${step.title} · Schema`, {
        schemaType: 'manual',
        inputSchema: JSON.stringify(w.structured.$ref ? { type: 'object', description: `See ${w.structured.$ref}` } : w.structured, null, 2),
      });
      nodes.push(parser);
      connections[parser.name] = { ai_outputParser: [[{ node: main.name, type: 'ai_outputParser', index: 0 }]] };
    }
    return { nodes, connections, entry: main.name, exits: { default: [main.name] } };
  },

  agent(step, ctx) {
    const w = step.with ?? {};
    const main = mk('agent', step.title, {
      promptType: 'define',
      text: w.prompt ?? '={{ $json.text }}',
      options: { systemMessage: w.system ?? '', maxIterations: w.max_iterations ?? 8 },
      hasOutputParser: !!w.structured,
    });
    const model = modelNode(w.role ?? 'copy.longform', ctx.registry.models, `${step.title} · Model`);
    const nodes = [main, model];
    const connections = { [model.name]: { ai_languageModel: [[{ node: main.name, type: 'ai_languageModel', index: 0 }]] } };
    if (w.memory && w.memory !== 'none') {
      const mem = mk('memory', `${step.title} · Memory`, { sessionIdType: 'customKey', sessionKey: '={{ $("Envelope In").first().json.tenant_id }}:{{ $("Envelope In").first().json.brand_id }}', contextWindowLength: 12 });
      nodes.push(mem);
      connections[mem.name] = { ai_memory: [[{ node: main.name, type: 'ai_memory', index: 0 }]] };
    }
    for (const toolCap of w.tools ?? []) {
      const tool = mk('toolWorkflow', `Tool · ${toolCap}`, {
        name: toolCap.replace(/\./g, '_'),
        description: `=Calls the ${toolCap} capability. Inputs must match its declared input schema.`,
        workflowId: { __rl: true, value: toolCap, mode: 'id', cachedResultName: toolCap },
        workflowInputs: { mappingMode: 'defineBelow', value: { envelope: '={{ $json }}' } },
      });
      nodes.push(tool);
      connections[tool.name] = { ai_tool: [[{ node: main.name, type: 'ai_tool', index: 0 }]] };
    }
    if (w.structured) {
      const parser = mk('parser', `${step.title} · Schema`, { schemaType: 'manual', inputSchema: JSON.stringify(w.structured.$ref ? { type: 'object', description: `See ${w.structured.$ref}` } : w.structured, null, 2) });
      nodes.push(parser);
      connections[parser.name] = { ai_outputParser: [[{ node: main.name, type: 'ai_outputParser', index: 0 }]] };
    }
    return { nodes, connections, entry: main.name, exits: { default: [main.name] } };
  },

  telegram(step) {
    const w = step.with ?? {};
    const opMap = { sendMessage: 'sendMessage', sendPhoto: 'sendPhoto', sendVideo: 'sendVideo', sendDocument: 'sendDocument', getFile: 'get' };
    const params = { resource: w.operation === 'getFile' ? 'file' : 'message', operation: opMap[w.operation] ?? 'sendMessage', chatId: w.chatId, additionalFields: {} };
    if (w.text) params.text = w.text;
    if (w.parseMode) params.additionalFields.parse_mode = w.parseMode;
    if (w.file) { params.binaryData = false; params[w.operation === 'sendPhoto' ? 'file' : 'file'] = w.file; }
    if (w.caption) params.additionalFields.caption = w.caption;
    if (w.buttons) params.replyMarkup = 'inlineKeyboard', params.inlineKeyboard = { rows: [{ row: { buttons: w.buttons.map((b) => ({ text: b.text, additionalFields: { url: b.url } })) } }] };
    const n = mk('telegram', step.title, params, step.onError === 'continue' ? { onError: 'continueRegularOutput' } : {});
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  gdrive(step) {
    const w = step.with ?? {};
    const map = { upload: ['file', 'upload'], share: ['file', 'share'], delete: ['file', 'deleteFile'] };
    const [resource, operation] = map[w.operation] ?? ['file', 'upload'];
    const params = { resource, operation };
    if (w.name) params.name = w.name;
    if (w.folder) params.folderId = { __rl: true, value: w.folder, mode: 'url' };
    if (w.fileId) params.fileId = { __rl: true, value: w.fileId, mode: 'id' };
    if (operation === 'share') params.permissionsUi = { permissionsValues: { role: w.permission ?? 'reader', type: w.type ?? 'anyone' } };
    const n = mk('gdrive', step.title, params, step.onError === 'continue' ? { onError: 'continueRegularOutput' } : {});
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },

  gsheets(step) {
    const w = step.with ?? {};
    const n = mk('gsheets', step.title, {
      operation: w.operation ?? 'append',
      documentId: { __rl: true, value: w.documentId, mode: 'id' },
      sheetName: { __rl: true, value: w.sheetName ?? 'Sheet1', mode: 'name' },
      columns: { mappingMode: w.mappingMode ?? 'autoMapInputData', matchingColumns: [], schema: [] },
      options: {},
    });
    return { nodes: [n], connections: {}, entry: n.name, exits: { default: [n.name] } };
  },
};

export function buildStep(step, ctx) {
  const b = BUILD[step.kind];
  if (!b) throw new Error(`Unknown step kind "${step.kind}" in ${ctx.capability.id} (step ${step.id})`);
  return b(step, ctx);
}

export function buildTrigger(trg) {
  switch (trg.kind) {
    case 'telegram': return mk('telegramTrigger', trg.title ?? 'Telegram Trigger', { updates: ['message'], additionalFields: {} }, { webhookId: id('wh') });
    case 'webhook': return mk('webhook', trg.title ?? 'Webhook', { httpMethod: trg.method ?? 'POST', path: trg.path ?? 'mos', responseMode: 'responseNode', options: {} }, { webhookId: id('wh') });
    case 'schedule': return mk('schedule', trg.title ?? 'Schedule', { rule: { interval: [{ field: 'cronExpression', expression: trg.cron ?? '0 9 * * *' }] } });
    case 'manual': return mk('manual', trg.title ?? 'Manual', {});
    case 'executeWorkflow':
    default: return mk('executeWorkflowTrigger', trg.title ?? 'When Executed by Another Workflow', { inputSource: 'passthrough' });
  }
}

export { mk, T };
