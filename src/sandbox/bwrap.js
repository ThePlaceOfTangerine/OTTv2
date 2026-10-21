const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { InfrastructureError } = require('../game/protocol');
const { SandboxManager, DockerSession } = require('./docker');

// The grader rootfs (scripts/wsl) is built FROM the sandbox image and records that image ID here, so jobs pinned to it stay comparable.
const ARENA = process.env.OTT_SUPERVISOR_DIR || (fs.existsSync('/opt/arena/supervisor.py') ? '/opt/arena' : path.resolve(__dirname, '../../sandbox'));
const IMAGE_FILE = path.join(ARENA, 'IMAGE_ID');
const ENV = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC', PYTHONDONTWRITEBYTECODE: '1' };

// Same isolation as the Docker container: no network/IPC/PID sharing, uid 65534, no capabilities, read-only system,
// private tmpfs for /tmp (16 MB) and /work (64 MB) as in Docker (red team: without --size a bot wrote 616 MB of RAM in one 0.5 s move, 8 MB file by file), the bot mounted read-only. Landlock/seccomp/rlimits come from supervisor.py itself.
function bwrapArgs({ source, mode, language, entry }) {
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--uid', '65534', '--gid', '65534', '--ro-bind', '/usr', '/usr'];
  // Merged-/usr distros (Debian bookworm) make these symlinks into /usr; recreate them instead of binding.
  for (const dir of ['/lib', '/lib64', '/bin', '/sbin']) {
    if (!fs.existsSync(dir)) continue;
    if (fs.lstatSync(dir).isSymbolicLink()) args.push('--symlink', fs.readlinkSync(dir), dir); else args.push('--ro-bind', dir, dir);
  }
  // /etc/passwd is present but Landlock denies it, matching the Docker image (probe and fixtures expect "permission denied").
  for (const file of ['/etc/alternatives', '/etc/ld.so.cache', '/etc/passwd']) if (fs.existsSync(file)) args.push('--ro-bind', file, file);
  args.push('--ro-bind', ARENA, '/opt/arena', '--proc', '/proc', '--dev', '/dev', '--perms', '1777', '--size', String(16 * 1048576), '--tmpfs', '/tmp', '--perms', '1777', '--size', String(64 * 1048576), '--tmpfs', '/work');
  if (source) args.push('--ro-bind', source, mode === 'compile' ? '/source' : '/bot');
  args.push('--chdir', '/work', '/usr/bin/python3', '-I', '-B', '/opt/arena/supervisor.py', ...(mode === 'probe' ? ['probe'] : [mode, language, entry]));
  return args;
}
class BwrapSession extends DockerSession {
  launch() { return spawn('bwrap', bwrapArgs(this.options), { shell: false, env: ENV, detached: false }); }
  async remove() {}
}
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('bwrap', args, { shell: false, env: ENV });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(new InfrastructureError('bwrap_unavailable', error.message)); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout.trim()) : reject(new InfrastructureError('bwrap_error', stderr.trim() || `bwrap exited ${code}`)); });
  });
}
class BwrapManager extends SandboxManager {
  constructor() { super(); this.image = fs.existsSync(IMAGE_FILE) ? fs.readFileSync(IMAGE_FILE, 'utf8').trim() : 'bwrap-unpinned'; }
  async check() {
    if (process.platform !== 'linux') throw new InfrastructureError('bwrap_unavailable', 'Backend bwrap chỉ chạy trên Linux/WSL2.');
    if (this.imageId && this.imageId !== this.image) throw new InfrastructureError('image_mismatch', `Máy chấm có môi trường ${this.image}, việc yêu cầu ${this.imageId}.`);
    const lines = (await run(bwrapArgs({ mode: 'probe' }))).split('\n');
    const result = JSON.parse(lines.at(-1));
    if (result.kind !== 'probe' || !result.passwd_denied || !result.seccomp || result.landlock_abi < 3) throw new InfrastructureError('sandbox_probe_failed');
    this.imageId = this.image;
    return { available: true, backend: 'bwrap', image: this.image, ...result };
  }
  session(options) { return new BwrapSession(options); }
}
module.exports = { BwrapManager, bwrapArgs };
