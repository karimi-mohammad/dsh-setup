// Reviewer Safety Gate — permanent host plugin for the dsh `web` profile.
//
// ROLLBACK (10 seconds, no DSH knowledge needed):
//   open ../cordis.patch.yml and comment out the two `- id:` / `name:` lines
//   under `insert:` with `#`, then restart DSH. Deleting this file works too.
//
// Intercepts dangerous tool calls through `tools/pre-execute`, asks an
// independent reviewer model through the session's model route, then:
//   allow -> runs immediately | ask -> pauses, native approval UI decides |
//   deny  -> blocked, reason returned to the agent.
import { defineTool } from '@deepseek-ai/dsh-tools';

const REVIEWER_SYSTEM = [
  'You are the independent safety reviewer for an AI coding agent running on the user own machine.',
  'You receive ONE requested tool call as JSON: the tool name, its full arguments preview, and optional missionContext describing the current overall task.',
  'Judge two things:',
  '(1) SAFETY - could this destroy or corrupt data, delete or overwrite files outside the intended scope, harm the operating system, install or run something hostile, exfiltrate secrets, or cause damage far beyond the stated task?',
  '(2) FIT - does it plausibly serve the missionContext (when provided) rather than being random or contradictory?',
  'Decide exactly one of:',
  '- allow: routine, reasonably scoped, reversible, and consistent with the task. Execution proceeds immediately.',
  '- ask: uncertain, potentially dangerous, unusually broad, irreversible-looking, or off-task. Execution PAUSES and your reason is shown to the human user in the UI, who then approves or rejects.',
  '- deny: clearly destructive, harmful, or dangerous. Execution is BLOCKED and your reason is returned to the agent as the denial explanation.',
  'Be pragmatic: normal development work such as reading files, building, running tests, editing project files, or git commits should be allow.',
  'Respond with ONLY a minified JSON object and nothing else, no markdown fences, in this exact shape:',
  '{"decision":"allow","reason":"<one to three concrete sentences>"}',
  'Write the reason in the same language as missionContext when present, otherwise English.'
].join('\n');

const state = {
  enabled: true,
  provider: 'openrouter',
  model: 'deepseek-v4-flash',
  missionContext: '',
  onError: 'allow',
  timeoutMs: 45000,
  maxArgChars: 4000,
  watching: new Set(['pwsh', 'bash', 'edit', 'write', 'job_kill', 'interrupt_agent']),
  history: [],
  counts: { allow: 0, ask: 0, deny: 0, error: 0 }
};

function clip(value, maxStr, maxKeys, maxArr) {
  if (typeof value === 'string') {
    return value.length > maxStr ? value.slice(0, maxStr) + '...[' + value.length + ' chars total]' : value;
  }
  if (Array.isArray(value)) return value.slice(0, maxArr).map((v) => clip(v, maxStr, maxKeys, maxArr));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).slice(0, maxKeys)) out[key] = clip(value[key], maxStr, maxKeys, maxArr);
    return out;
  }
  return value;
}

function buildPayload(exec) {
  let args = undefined;
  try { args = clip(exec.arguments, 600, 40, 30); } catch (e) { args = { unserializable: true }; }
  let text = '';
  try { text = JSON.stringify(args, null, 2); } catch (e) { text = String(args); }
  if (text.length > state.maxArgChars) text = text.slice(0, state.maxArgChars) + '...[truncated]';
  return {
    tool: exec.name,
    argumentsPreview: text,
    missionContext: state.missionContext !== '' ? state.missionContext : undefined
  };
}

function mintId() {
  return 'rg-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000000000).toString(36);
}

async function resolveRoute(ctx) {
  if (state.provider !== undefined && state.model !== undefined) {
    return { provider: state.provider, model: state.model, source: 'manual override' };
  }
  const selector = ctx.get('agentDefaultModel');
  if (selector !== undefined) {
    try {
      const sel = selector.currentSelection();
      if (sel !== undefined && sel !== null && sel.provider && sel.model) {
        return { provider: sel.provider, model: sel.model, source: 'session default model' };
      }
    } catch (e) { /* fall through */ }
  }
  return undefined;
}

function extractJson(text) {
  let candidate = text;
  // Strip thinking tags from models like DeepSeek
  candidate = candidate.replace(/<think>[\s\S]*?<\/think>/gi, '');
  candidate = candidate.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  const openFence = candidate.indexOf('```');
  if (openFence !== -1) {
    const bodyStart = candidate.indexOf('\n', openFence);
    const closeFence = candidate.indexOf('```', openFence + 3);
    if (bodyStart !== -1 && closeFence !== -1 && closeFence > bodyStart) candidate = candidate.slice(bodyStart + 1, closeFence);
    else if (closeFence !== -1) candidate = candidate.slice(openFence + 3, closeFence);
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    const verdict = JSON.parse(candidate.slice(start, end + 1));
    if (verdict !== null && typeof verdict === 'object'
      && (verdict.decision === 'allow' || verdict.decision === 'ask' || verdict.decision === 'deny')
      && typeof verdict.reason === 'string' && verdict.reason.length > 0) {
      return { decision: verdict.decision, reason: verdict.reason.slice(0, 1200) };
    }
  } catch (e) { /* not json */ }
  return undefined;
}

function pushHistory(entry) {
  state.history.unshift({
    at: new Date().toTimeString().slice(0, 8),
    tool: entry.tool,
    verdict: entry.verdict,
    reason: entry.reason !== undefined ? String(entry.reason).slice(0, 300) : ''
  });
  if (state.history.length > 40) state.history.length = 40;
}

export default {
  name: 'reviewer-gate',
  inject: ['llm', 'timer', 'tools'],
  apply(ctx) {
    async function askReviewer(exec) {
      const route = await resolveRoute(ctx);
      if (route === undefined) throw new Error('no model route available (no override and no session default model)');
      const payload = buildPayload(exec);
      const message = {
        id: mintId(),
        role: 'user',
        content: [{ type: 'text', text: 'Review this requested action:\n' + JSON.stringify(payload, null, 2) }],
        source: { kind: 'plugin', plugin: 'reviewer-gate' }
      };
      const options = {
        provider: route.provider,
        model: route.model,
        messages: [message],
        system: REVIEWER_SYSTEM,
        maxTokens: 4000,
        signal: exec.signal,
        sessionId: exec.agent !== undefined && exec.agent.session !== undefined ? exec.agent.session.id : undefined
      };
      const deadline = ctx.timeout(state.timeoutMs);
      let text = '';
      let finish = undefined;
      let thinking = '';
      const iterator = ctx.llm.stream(options)[Symbol.asyncIterator]();
      while (true) {
        const step = await Promise.race([
          iterator.next(),
          deadline.then(() => ({ timedOut: true }))
        ]);
        if (step.timedOut === true) throw new Error('reviewer did not answer within ' + state.timeoutMs + 'ms');
        if (step.done === true) break;
        const chunk = step.value;
        if (chunk.type === 'text-delta') text += chunk.text;
        else if (chunk.type === 'thinking-delta') thinking += chunk.text;
        else if (chunk.type === 'finish') finish = chunk.reason;
      }
      if (finish !== undefined && finish.kind === 'error') {
        throw new Error('reviewer model request failed: ' + (finish.failure !== undefined && finish.failure.message !== undefined ? finish.failure.message : 'unknown error'));
      }
      if (finish !== undefined && finish.kind === 'aborted') throw new Error('reviewer model request was aborted');
      const combined = text || thinking;
      const verdict = extractJson(combined);
      if (verdict === undefined) throw new Error('reviewer returned an unparsable answer: ' + combined.slice(0, 200));
      verdict.route = route;
      return verdict;
    }

    async function review(exec, next) {
      let verdict = undefined;
      let failure = undefined;
      try { verdict = await askReviewer(exec); } catch (e) { failure = String(e !== undefined && e.message !== undefined ? e.message : e); }
      if (verdict === undefined) {
        state.counts.error++;
        pushHistory({ tool: exec.name, verdict: 'error', reason: failure });
        console.log('[reviewer-gate] reviewer unavailable for', exec.name, '-', failure);
        if (state.onError === 'allow') return next();
        return { kind: 'ask', reason: '[Reviewer Gate] The safety reviewer could not be reached (' + failure + '). Decide yourself whether to allow this "' + exec.name + '" call.' };
      }
      if (verdict.decision === 'allow') {
        state.counts.allow++;
        pushHistory({ tool: exec.name, verdict: 'allow', reason: verdict.reason });
        console.log('[reviewer-gate] ALLOW', exec.name, '-', verdict.reason);
        return next();
      }
      if (verdict.decision === 'deny') {
        state.counts.deny++;
        pushHistory({ tool: exec.name, verdict: 'deny', reason: verdict.reason });
        console.log('[reviewer-gate] DENY', exec.name, '-', verdict.reason);
        return { kind: 'deny', reason: '[Reviewer Gate] Blocked by the safety reviewer: ' + verdict.reason };
      }
      state.counts.ask++;
      pushHistory({ tool: exec.name, verdict: 'ask', reason: verdict.reason });
      console.log('[reviewer-gate] ASK', exec.name, '-', verdict.reason);
      return { kind: 'ask', reason: '[Reviewer Gate] ' + verdict.reason };
    }

    ctx.on('tools/pre-execute', (exec, next) => {
      if (state.enabled !== true) return next();
      if (!state.watching.has(exec.name)) return next();
      return review(exec, next);
    });

    function describe() {
      return {
        enabled: state.enabled,
        reviewerOverride: state.provider !== undefined && state.model !== undefined ? state.provider + '/' + state.model : null,
        watching: Array.from(state.watching).sort(),
        missionContext: state.missionContext === '' ? null : state.missionContext,
        onError: state.onError,
        timeoutMs: state.timeoutMs,
        history: state.history.slice(0, 15),
        counts: state.counts
      };
    }

    ctx.tools.register(defineTool({
      name: 'gate_config',
      description: 'Configure the reviewer-gate safety plugin: show its state, enable or disable interception, choose which reviewer model reviews dangerous actions (provider/model pair), add or remove watched tools, set free-text mission context that is sent along with each review request, or change what happens when the reviewer is unreachable (ask the user, or fail open).',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['get', 'enable', 'disable', 'set-reviewer', 'clear-reviewer', 'watch', 'unwatch', 'set-mission', 'clear-mission', 'set-on-error'],
          description: 'Configuration action to perform.'
        },
        provider: { type: 'string', description: 'Provider route for set-reviewer.' },
        model: { type: 'string', description: 'Model id for set-reviewer.' },
        tool: { type: 'string', description: 'Tool name for watch/unwatch.' },
        mission: { type: 'string', description: 'Free-text description of the current task for set-mission.' },
        value: { type: 'string', enum: ['allow', 'ask'], description: 'New unreachable-reviewer behavior for set-on-error.' }
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
      async execute(args) {
        const a = args.action;
        if (a === 'enable') state.enabled = true;
        else if (a === 'disable') state.enabled = false;
        else if (a === 'set-reviewer') {
          if (typeof args.provider !== 'string' || args.provider === '' || typeof args.model !== 'string' || args.model === '') {
            throw new Error('set-reviewer requires both provider and model');
          }
          state.provider = args.provider;
          state.model = args.model;
        } else if (a === 'clear-reviewer') {
          state.provider = undefined;
          state.model = undefined;
        } else if (a === 'watch') {
          if (typeof args.tool !== 'string' || args.tool === '') throw new Error('watch requires tool');
          state.watching.add(args.tool);
        } else if (a === 'unwatch') {
          if (typeof args.tool !== 'string' || args.tool === '') throw new Error('unwatch requires tool');
          state.watching.delete(args.tool);
        } else if (a === 'set-mission') {
          if (typeof args.mission !== 'string' || args.mission.trim() === '') throw new Error('set-mission requires mission');
          state.missionContext = args.mission.trim().slice(0, 2000);
        } else if (a === 'clear-mission') {
          state.missionContext = '';
        } else if (a === 'set-on-error') {
          if (args.value !== 'allow' && args.value !== 'ask') throw new Error('set-on-error requires value allow or ask');
          state.onError = args.value;
        }
        return describe();
      }
    }));

    console.log('[reviewer-gate] host plugin active; watching', Array.from(state.watching).join(', '));
  }
};
