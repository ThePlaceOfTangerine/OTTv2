const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { MatchService } = require('../src/sandbox/match-service');
const { InfrastructureError, BotFault } = require('../src/game/protocol');
const { containerArgs, stageSources, SandboxManager } = require('../src/sandbox/docker');
const { verifyReplay } = require('../src/game/match');

function setup(manager) {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,?,?,?,?)').run('admin', 'test', 'admin', 0);
  return { db, service: new MatchService(db, { manager, retryDelayMs: 0 }) };
}
function fakeManager(failures = 0) {
  return {
    checks: 0, closed: 0, disposed: 0,
    async check() { if (++this.checks <= failures) throw new InfrastructureError('docker_unavailable'); return { available: true }; },
    async prepare(source) { return { hash: source.id, image: 'test-image', compile_cpu_ms: 1 }; },
    async start() { return { move: async request => ({ stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }), cpu_ms: 1 }), close: async () => { this.closed++; } }; },
    async dispose() { this.disposed++; }
  };
}
const input = { userId: 1, botA: 'python-greedy', botB: 'cpp-greedy', seed: 'service-test' };
test('practice match retries infrastructure failure and persists replay with seed, rules and logs', async () => {
  const manager = fakeManager(1), { db, service } = setup(manager);
  try {
    const id = service.create(input);
    assert.throws(() => service.create(input), error => error.status === 409);
    await service.active;
    const match = service.get(id);
    assert.equal(match.status, 'finished'); assert.equal(match.attempts, 2);
    assert.equal(match.attempt_log[0].code, 'docker_unavailable');
    assert.equal(match.replay.seed, input.seed); assert.equal(match.replay.rule_set_id, 'ottv2-classic');
    assert.ok(verifyReplay(match.replay)); assert.equal(manager.closed, 2); assert.equal(manager.disposed, 2);
    assert.equal(service.list().length, 1);
  } finally { db.close(); }
});
test('three infrastructure failures never forfeit either bot', async () => {
  const { db, service } = setup(fakeManager(10));
  try {
    const id = service.create(input); await service.active;
    const match = service.get(id);
    assert.equal(match.status, 'infrastructure_error'); assert.equal(match.replay, null); assert.equal(match.attempts, 3);
    assert.equal(match.attempt_log.length, 3);
  } finally { db.close(); }
});
test('compiler rejection is a bot error and is not retried as infrastructure', async () => {
  const manager = fakeManager(); manager.prepare = async () => { throw new BotFault('compile_error', 'syntax error'); };
  const { db, service } = setup(manager);
  try {
    const id = service.create(input); await service.active;
    assert.equal(service.get(id).status, 'bot_error'); assert.equal(service.get(id).attempts, 1);
    assert.equal(service.get(id).error.code, 'compile_error');
  } finally { db.close(); }
});
test('server restart records interrupted matches as infrastructure errors', async () => {
  const { db } = setup(fakeManager());
  try {
    db.prepare("INSERT INTO practice_matches(id,created_by,created_at,updated_at,status,seed,rules_json,bots_json) VALUES ('old',1,0,0,'running','seed','{}','[]')").run();
    const service = new MatchService(db, { manager: fakeManager() });
    assert.equal(service.get('old').status, 'infrastructure_error'); assert.equal(service.get('old').replay, null);
  } finally { db.close(); }
});
test('invalid bot selection, arbitrary paths and unsupported files are rejected', async () => {
  const { db, service } = setup(fakeManager());
  try {
    assert.throws(() => service.create({ ...input, botA: '../../escape' }), error => error.status === 400);
    assert.throws(() => service.create({ ...input, seed: {} }), error => error.status === 400);
    await assert.rejects(stageSources({ language: 'python', entry: '../escape.py', directory: '.' }));
    await assert.rejects(stageSources({ language: 'python', entry: 'main.py', directory: path.resolve(__dirname, '../bots/cpp-greedy') }));
  } finally { db.close(); }
});
test('Docker command construction always includes mandatory isolation without host writes', () => {
  const args = containerArgs({ name: 'test', image: 'sha256:test', source: path.resolve('bots/python-greedy'), mode: 'run', language: 'python', entry: 'main.py' });
  for (const flag of ['--rm', '--network=none', '--read-only', '--user=65534:65534', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--cpus=1', '--pids-limit=64', '--log-driver=none']) assert.ok(args.includes(flag), flag);
  assert.ok(args.some(s => s.startsWith('--memory='))); assert.ok(args.some(s => s.startsWith('--memory-swap=')));
  assert.ok(args.some(s => s.includes('target=/bot,readonly')));
  assert.ok(!args.some(s => /privileged|docker.sock|seccomp=unconfined/.test(s)));
});
test('missing Docker fails closed before any bot can run', async () => {
  const previous = process.env.DOCKER_BIN;
  process.env.DOCKER_BIN = path.resolve(__dirname, 'docker-does-not-exist');
  try {
    await assert.rejects(new SandboxManager().prepare({ language: 'python', entry: 'main.py', directory: '.' }), error => error instanceof InfrastructureError && error.code === 'docker_unavailable');
  } finally { if (previous === undefined) delete process.env.DOCKER_BIN; else process.env.DOCKER_BIN = previous; }
});
