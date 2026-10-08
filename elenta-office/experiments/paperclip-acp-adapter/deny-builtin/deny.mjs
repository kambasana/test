// Experiment: an external adapter that takes over a built-in Paperclip adapter type and refuses to
// run anything. Paperclip lets an external adapter replace a built-in type
// (server/src/adapters/registry.ts:953-975, 988-996); "disabled" alone only hides a type from
// creation menus and still runs existing agents (registry.ts:1102-1112; verified in the experiment).
// One directory per type: deny-builtin/<type>/{package.json,index.mjs}.
export function makeDenyAdapter(denyType) {
  return {
    type: denyType,
    async execute(ctx) {
      await ctx.onLog?.('stderr', `[elenta] adapter type "${denyType}" is switched off on this instance; nothing was run.\n`);
      return { exitCode: 1, signal: null, timedOut: false, errorMessage: `Adapter "${denyType}" is switched off (Elenta deny stub).` };
    },
    async testEnvironment() {
      return { adapterType: denyType, status: 'fail', checks: [{ level: 'error', message: 'switched off', code: 'denied' }], testedAt: new Date().toISOString() };
    },
    models: [],
    agentConfigurationDoc: `# ${denyType}\nSwitched off on this instance.`,
  };
}
