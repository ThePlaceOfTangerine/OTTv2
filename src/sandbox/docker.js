const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { BotFault, InfrastructureError, LIMITS } = require('../game/protocol');

const IMAGE = process.env.SANDBOX_IMAGE || 'ottv2-sandbox:phase3';
function dockerBinary() {
  if (process.env.DOCKER_BIN) return process.env.DOCKER_BIN;
  if (process.platform !== 'win32') return 'docker';
  const roots = [process.env.LOCALAPPDATA, path.join(process.env.USERPROFILE || os.homedir(), 'AppData/Local')].filter(Boolean);
  const candidates = [path.join(process.env.ProgramFiles || 'C:/Program Files', 'Docker/Docker/resources/bin/docker.exe'),
    ...roots.map(root => path.join(root, 'Programs/DockerDesktop/resources/bin/docker.exe'))];
  return candidates.find(file => fs.existsSync(file)) || 'docker';
}
function dockerEnv() { return { ...process.env, PATH: `${path.dirname(dockerBinary())}${path.delimiter}${process.env.PATH || ''}` }; }
function dockerCommand(args, { timeout = 15000, maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBinary(), args, { windowsHide: true, shell: false, env: dockerEnv() });
    let stdout = '', stderr = '', size = 0, settled = false;
    const done = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill(); done(new InfrastructureError('docker_timeout')); }, timeout);
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { child.kill(); done(new InfrastructureError('docker_output_limit')); return; }
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
    });
    child.on('error', error => done(new InfrastructureError('docker_unavailable', error.message)));
    child.on('close', code => code === 0 ? done(null, stdout.trim()) : done(new InfrastructureError('docker_error', stderr.trim() || `Docker exited ${code}`)));
  });
}
function containerArgs({ name, image, source, mode, language, entry, limits = LIMITS }) {
  if (source.includes(',')) throw new InfrastructureError('invalid_mount_path', 'Docker source path cannot contain commas');
  return ['run', '--rm', '--pull=never', '-i', '--name', name, '--network=none', '--read-only', '--user=65534:65534',
    '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--cpus=1',
    `--memory=${mode === 'compile' ? 1024 : limits.memoryMb + 64}m`, `--memory-swap=${mode === 'compile' ? 1024 : limits.memoryMb + 64}m`,
    '--pids-limit=64', '--ulimit=nofile=64:64', '--ulimit=core=0:0', '--log-driver=none',
    '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777', '--tmpfs=/work:rw,exec,nosuid,nodev,size=64m,mode=1777',
    '--mount', `type=bind,source=${source},target=${mode === 'compile' ? '/source' : '/bot'},readonly`,
    image, mode, language, entry];
}

class DockerSession {
  constructor(options) { this.options = options; this.name = `ottv2-${crypto.randomUUID()}`; this.sequence = 0; this.closed = false; }
  async start() {
    this.child = spawn(dockerBinary(), containerArgs({ ...this.options, name: this.name }), { windowsHide: true, shell: false, env: dockerEnv() });
    let buffer = '', stderr = '';
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.child.stdin.on('error', error => this.fail(new InfrastructureError('docker_stdin', error.message)));
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) { this.fail(new InfrastructureError('supervisor_output_limit')); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let response; try { response = JSON.parse(line); } catch { this.fail(new InfrastructureError('invalid_supervisor_json')); return; }
        if (response.kind === 'ready' && response.landlock_abi >= 3) this.readyResolve();
        else if (response.kind === 'result' && this.pending && response.id === this.pending.id) {
          const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.resolve(response);
        } else if (response.kind === 'infrastructure_error') this.fail(new InfrastructureError('supervisor_unavailable', response.error));
        else this.fail(new InfrastructureError('invalid_supervisor_message'));
      }
    });
    this.child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    this.child.on('error', error => this.fail(new InfrastructureError('docker_unavailable', error.message)));
    this.child.on('close', code => { if (!this.closed) this.fail(new InfrastructureError('container_exit', stderr || `Container exited ${code}`)); });
    const timer = setTimeout(() => this.fail(new InfrastructureError('container_start_timeout')), 30000);
    try { await this.ready; } finally { clearTimeout(timer); }
    return this;
  }
  fail(error) {
    this.failure = error; this.readyReject?.(error);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
  }
  call(request, timeout = 20000) {
    if (this.closed || this.failure) return Promise.reject(this.failure || new InfrastructureError('session_closed'));
    if (this.pending) return Promise.reject(new InfrastructureError('concurrent_bot_request'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending = { id, resolve, reject, timer: setTimeout(() => this.fail(new InfrastructureError('supervisor_timeout')), timeout) };
      this.child.stdin.write(JSON.stringify({ id, request }) + '\n');
    });
  }
  async move(request) {
    const result = await this.call(request, request.limits.moveWallMs + 10000);
    if (result.fault) { const error = new BotFault(result.fault, result.stderr || result.fault); error.metrics = result; throw error; }
    return result;
  }
  async close() {
    this.fail(new InfrastructureError('session_closed'));
    this.closed = true;
    // Removing our exact UUID container also works when the attached Docker CLI
    // disconnects. A cleanup failure is infrastructure failure, not a forfeit.
    let cleanup;
    try { await dockerCommand(['rm', '-f', this.name]); }
    catch (error) { if (!/No such container|removal of container .* already in progress/i.test(error.message)) cleanup = error; }
    this.child?.stdin.destroy();
    this.child?.kill();
    if (cleanup) throw cleanup;
  }
}

async function stageSources(source) {
  if (!['python', 'cpp'].includes(source.language) || !/^[a-zA-Z0-9_./-]+$/.test(source.entry) || source.entry.split('/').includes('..') || source.entry.startsWith('/')) throw new Error('Invalid bot descriptor');
  if (!source.entry.endsWith(source.language === 'python' ? '.py' : '.cpp')) throw new Error('Invalid entry extension');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ott-source-'));
  await fsp.chmod(directory, 0o755);
  const hash = crypto.createHash('sha256'); let count = 0, bytes = 0;
  async function copy(current, relative = '') {
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Symlinks are forbidden');
    if (stat.isDirectory()) {
      if (relative) await fsp.mkdir(path.join(directory, relative), { recursive: true, mode: 0o755 });
      for (const name of (await fsp.readdir(current)).sort()) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid source filename');
        await copy(path.join(current, name), relative ? `${relative}/${name}` : name);
      }
    } else {
      if (!stat.isFile() || !relative || !new RegExp(source.language === 'python' ? '\\.py$' : '\\.(cpp|h|hpp)$').test(relative)) throw new Error('Unsupported source file');
      bytes += stat.size; if (++count > 64 || bytes > 5 * 1024 * 1024 || stat.size > 1024 * 1024) throw new Error('Source size limit');
      const data = await fsp.readFile(current); hash.update(relative + '\0').update(data);
      await fsp.writeFile(path.join(directory, relative), data, { mode: 0o644 });
    }
  }
  try {
    await copy(path.resolve(source.directory));
    if (!(await fsp.stat(path.join(directory, source.entry))).isFile()) throw new Error('Entry not found');
    return { directory, hash: hash.digest('hex') };
  } catch (error) { await removeStage(directory); throw error; }
}

async function removeStage(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('ott-source-')) throw new Error('Refusing unsafe sandbox staging cleanup');
  await fsp.rm(resolved, { recursive: true, force: true });
}

class SandboxManager {
  constructor() { this.image = IMAGE; }
  async check() {
    const info = JSON.parse(await dockerCommand(['info', '--format', '{{json .}}']));
    if (info.OSType !== 'linux' || info.CgroupVersion !== '2' || !info.SecurityOptions?.some(s => s.startsWith('name=seccomp')) || info.Warnings?.some(s => /No (memory|cpu|pids|swap)/i.test(s))) throw new InfrastructureError('docker_isolation_unavailable', 'Linux, cgroup v2, memory/CPU/PID limits and Docker seccomp are required');
    const details = JSON.parse(await dockerCommand(['image', 'inspect', this.image]));
    this.imageId ||= details[0].Id;
    const probeName = `ottv2-probe-${crypto.randomUUID()}`;
    try {
      const result = JSON.parse(await dockerCommand(['run', '--rm', '--pull=never', '--name', probeName, '--network=none', '--read-only', '--user=65534:65534', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=128m', '--memory-swap=128m', '--cpus=1', '--pids-limit=16', '--log-driver=none', this.imageId, 'probe']));
      if (result.kind !== 'probe' || !result.passwd_denied || !result.seccomp || result.landlock_abi < 3) throw new InfrastructureError('sandbox_probe_failed');
      return { available: true, image: this.imageId, kernel: info.KernelVersion, ...result };
    } finally { await dockerCommand(['rm', '-f', probeName]).catch(error => { if (!/No such container|removal of container .* already in progress/i.test(error.message)) throw error; }); }
  }
  async prepare(source) {
    if (!this.imageId) await this.check();
    const staged = await stageSources(source);
    const session = new DockerSession({ image: this.imageId, source: staged.directory, mode: 'compile', language: source.language, entry: source.entry });
    try {
      await session.start();
      const compiled = await session.call({}, 55000);
      if (compiled.fault) throw new BotFault('compile_error', compiled.stderr || compiled.fault);
      if (source.language === 'cpp') {
        const binary = Buffer.from(compiled.binary || '', 'base64');
        if (binary.length < 4 || binary.length > 8 * 1024 * 1024 || binary.subarray(0, 4).toString('hex') !== '7f454c46') throw new InfrastructureError('invalid_artifact');
        await fsp.writeFile(path.join(staged.directory, 'bot'), binary, { mode: 0o755 });
      }
      return { ...staged, language: source.language, entry: source.entry, image: this.imageId, compile_cpu_ms: compiled.cpu_ms, compile_stderr: compiled.stderr };
    } catch (error) { await removeStage(staged.directory); throw error; }
    finally {
      try { await session.close(); }
      catch (error) { await removeStage(staged.directory); throw error; }
    }
  }
  async start(artifact, limits = LIMITS) {
    const session = new DockerSession({ image: artifact.image, source: artifact.directory, mode: 'run', language: artifact.language, entry: artifact.entry, limits });
    try { return await session.start(); } catch (error) { await session.close(); throw error; }
  }
  async dispose(artifact) { await removeStage(artifact.directory); }
}
module.exports = { SandboxManager, DockerSession, containerArgs, dockerCommand, dockerBinary, dockerEnv, stageSources };
