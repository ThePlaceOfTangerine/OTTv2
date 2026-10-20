const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSandboxManager } = require('../sandbox');
const { BotFault, InfrastructureError } = require('../game/protocol');
const { runCheck } = require('../submissions/check');
const { playGame } = require('./play');
const { signature } = require('./coordinator');
const { readTree, writeTree } = require('./files');
const { ENGINE_HASH } = require('./version');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Pulls leased jobs from the coordinator over HTTP(S) and runs them in the local sandbox; never touches the coordinator database.
class GraderAgent {
  constructor({ url, id, secret, slots = 1, kinds = ['submission', 'bracket', 'swiss'], managerFactory = () => createSandboxManager(), workDir = path.join(os.tmpdir(), 'ott-grader'),
    pollMs = 2000, heartbeatMs = 5000, fetch = globalThis.fetch, log = console.error } = {}) {
    if (!url || !id || !secret) throw new Error('Cần COORDINATOR_URL, GRADER_ID và GRADER_SECRET.');
    Object.assign(this, { url: url.replace(/\/$/, ''), id, secret, slots, kinds, managerFactory, workDir, pollMs, heartbeatMs, fetch, log });
    this.loops = []; this.fetching = new Map(); this.running = false;
  }
  async call(route, body = {}, { binary = false } = {}) {
    const payload = Buffer.from(JSON.stringify(body)), timestamp = Date.now(), nonce = crypto.randomBytes(16).toString('hex');
    const response = await this.fetch(this.url + route, { method: 'POST', body: payload, signal: AbortSignal.timeout(180000), headers: { 'Content-Type': 'application/json',
      'X-OTT-Grader': this.id, 'X-OTT-Timestamp': String(timestamp), 'X-OTT-Nonce': nonce, 'X-OTT-Signature': signature(this.secret, { method: 'POST', path: route, timestamp, nonce, body: payload }) } });
    if (response.status === 204) return null;
    if (response.status === 422) { const fault = await response.json(); throw new BotFault(fault.code, fault.message); }
    if (!response.ok) throw new InfrastructureError('coordinator_error', (await response.json().catch(() => ({}))).error || `Coordinator trả lỗi ${response.status}.`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  async start() {
    await fsp.mkdir(this.workDir, { recursive: true, mode: 0o755 });
    const info = await this.managerFactory().check();
    this.image = info?.image || null; this.running = true;
    for (let slot = 0; slot < this.slots; slot++) this.loops.push(this.loop());
  }
  async stop() { this.running = false; await Promise.allSettled(this.loops); this.loops = []; }
  async loop() {
    while (this.running) {
      let lease = null;
      try { lease = await this.call('/api/grader/claim', { image: this.image, slots: this.slots, kinds: this.kinds, engine: ENGINE_HASH }); }
      catch (error) { this.log('Grader claim:', error.message); }
      if (!lease) { await sleep(this.pollMs); continue; }
      await this.run(lease).catch(error => this.log('Grader job:', error.message));
    }
  }
  async run({ token, job }) {
    const base = { token, kind: job.kind, id: job.id };
    let latest;
    const timer = setInterval(() => {
      const live = latest; latest = undefined;
      this.call('/api/grader/heartbeat', live === undefined ? base : { ...base, live }).catch(error => this.log('Grader heartbeat:', error.message));
    }, this.heartbeatMs); timer.unref();
    try { await (job.kind === 'submission' ? this.check(job, base, live => { latest = live; }) : this.game(job, base, live => { latest = live; })); }
    finally { clearInterval(timer); }
  }
  async game(job, base, live) {
    let report;
    try { report = { replay: await playGame(job, { manager: this.managerFactory(), artifactDir: entrant => this.artifact(entrant.submissionId), onTurn: live }) }; }
    catch (error) { report = { error: { code: error.code || 'grader_error', message: error.message } }; }
    await this.report({ ...base, ...report });
  }
  async check(job, base, live) {
    const directory = await fsp.mkdtemp(path.join(this.workDir, 'check-')), meta = {}, tests = [];
    let artifact = null, error = null;
    try {
      await runCheck(job, { manager: this.managerFactory(), directory: path.join(directory, 'source'),
        source: () => this.call('/api/grader/source', base, { binary: true }),
        progress: async (status, message, details) => { if (!(await this.call('/api/grader/heartbeat', { ...base, events: [{ status, message, details }] })).leased) throw new InfrastructureError('lease_lost'); },
        meta: fields => { Object.assign(meta, fields); }, live, test: record => { tests.push(record); },
        keep: async dir => { artifact = await readTree(dir); } });
    } catch (problem) { error = { bot: problem instanceof BotFault, code: problem.code || 'system_error', message: problem.message }; }
    finally { await fsp.rm(directory, { recursive: true, force: true }); }
    await this.report({ ...base, meta, tests, artifact, error });
  }
  // Results are idempotent on the coordinator, so retrying a lost response is safe.
  async report(body) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.call('/api/grader/result', body); }
      catch (error) { if (attempt >= 4) throw error; await sleep(1000 * 2 ** attempt); }
    }
  }
  // Accepted artifacts never change, so they are cached per submission.
  artifact(submissionId) {
    if (!/^[0-9a-f-]{36}$/.test(submissionId)) throw new InfrastructureError('invalid_artifact_id');
    const directory = path.join(this.workDir, 'artifacts', submissionId);
    if (fs.existsSync(`${directory}.ok`)) return directory;
    if (!this.fetching.has(submissionId)) this.fetching.set(submissionId, (async () => {
      const temporary = `${directory}.tmp-${crypto.randomUUID()}`;
      try {
        await writeTree(temporary, await this.call('/api/grader/artifact', { submissionId }));
        await fsp.rm(directory, { recursive: true, force: true }); await fsp.rename(temporary, directory);
        await fsp.writeFile(`${directory}.ok`, '');
        return directory;
      } finally { await fsp.rm(temporary, { recursive: true, force: true }); this.fetching.delete(submissionId); }
    })());
    return this.fetching.get(submissionId);
  }
}
module.exports = { GraderAgent };
