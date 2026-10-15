const { GameEngine, validateRules } = require('./engine');
// Only trusted server modules may register engines; JSON never loads executable paths.
const engines = new Map([['rps-grid-v1', { validate: validateRules, create: options => new GameEngine(options) }]]);
function registerEngine(id, adapter) {
  if (!/^[a-z0-9-]{1,60}$/.test(id) || engines.has(id) || typeof adapter?.validate !== 'function' || typeof adapter?.create !== 'function') throw new Error('Invalid or duplicate trusted engine');
  engines.set(id, adapter);
}
function validateEngineRules(rules) {
  const adapter = engines.get(rules?.engine); if (!adapter) throw new Error('Bộ máy luật chưa được cài trên máy chủ.');
  return adapter.validate(rules);
}
function createEngine(options) {
  const rules = validateEngineRules(options.rules), engine = engines.get(rules.engine).create({ ...options, rules });
  if (['snapshot','legalMoves','apply','finish'].some(key => typeof engine[key] !== 'function') || !engine.rules || typeof engine.seed !== 'string') throw new Error('Invalid GameEngine interface');
  return engine;
}
module.exports = { registerEngine, validateEngineRules, createEngine, engineIds: () => [...engines.keys()] };
