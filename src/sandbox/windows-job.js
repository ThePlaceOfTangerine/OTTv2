const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { BotFault, InfrastructureError, LIMITS } = require('../game/protocol');
const { stageSources, removeStage } = require('./docker');

// EXPERIMENTAL: Job Objects limit CPU, memory and child processes but do NOT block network or file access.
const WARNING = 'Chế độ lớp học (windows-job): chưa chặn mạng và hệ thống file; chỉ dùng khi môi trường được giám sát. Giải thật phải dùng Docker hoặc WSL2.';
const ROOT = path.resolve(__dirname, '../..');
const SOURCE = path.join(ROOT, 'sandbox/windows/jobrun.cs');
// Classroom package layout: python/ (embeddable 3.11), cpp/mingw64/ (optional add-cpp.zip), vendor/include/ (nlohmann/json.hpp).
const bundled = file => fs.existsSync(path.join(ROOT, file)) ? path.join(ROOT, file) : null;
const CPP_INCLUDE = process.env.OTT_CPP_INCLUDE || bundled('vendor/include');
// g++ already installed by Dev-C++ / Code::Blocks in school computer rooms.
const IDE_GXX = ['C:/Program Files (x86)/Dev-Cpp/MinGW64/bin/g++.exe', 'C:/Program Files/Dev-Cpp/MinGW64/bin/g++.exe', 'C:/Program Files/CodeBlocks/MinGW/bin/g++.exe', 'C:/Program Files (x86)/CodeBlocks/MinGW/bin/g++.exe'];
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const RUNNER = 'import runpy,sys,os; sys.path[:0]=[os.path.dirname(sys.argv[1]),os.getcwd()]; runpy.run_path(sys.argv[1],run_name="__main__")';
const COMPILER = 'import pathlib; [compile(p.read_bytes(),str(p),"exec") for p in pathlib.Path(".").rglob("*.py")]';
const exec = (file, args) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 60000 }, (error, stdout, stderr) => error ? reject(new InfrastructureError('windows_job_setup', `${error.message}\n${stderr}`)) : resolve(stdout.trim())));

let helperPromise;
// The helper is rebuilt whenever jobrun.cs changes; the hash in the file name keeps stale builds unused.
function helper() {
  return helperPromise ||= (async () => {
    const hash = crypto.createHash('sha256').update(await fsp.readFile(SOURCE)).digest('hex').slice(0, 16);
    const prebuilt = path.join(path.dirname(SOURCE), `jobrun-${hash}.exe`); // shipped in the classroom package
    if (fs.existsSync(prebuilt)) return prebuilt;
    const exe = path.join(os.tmpdir(), 'ott-jobrun', `jobrun-${hash}.exe`);
    if (fs.existsSync(exe)) return exe;
    if (!fs.existsSync(CSC)) throw new InfrastructureError('windows_job_unavailable', 'Không tìm thấy csc.exe của .NET Framework 4.');
    await fsp.mkdir(path.dirname(exe), { recursive: true });
    const temporary = `${exe}.${crypto.randomUUID()}.exe`;
    await exec(CSC, ['/nologo', '/optimize', '/target:exe', `/out:${temporary}`, SOURCE]);
    await fsp.rename(temporary, exe).catch(error => { if (!fs.existsSync(exe)) throw error; });
    return exe;
  })().catch(error => { helperPromise = null; throw error; });
}
async function execute(command, input, { cpuMs, wallMs, memoryMb, outputBytes, processes }, cwd) {
  const exe = await helper();
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [cpuMs, wallMs, memoryMb, outputBytes, ...(processes ? [`--processes=${processes}`] : []), ...command].map(String), { cwd, windowsHide: true, shell: false });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new InfrastructureError('windows_job_timeout')); }, wallMs + 15000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.on('error', error => { clearTimeout(timer); reject(new InfrastructureError('windows_job_unavailable', error.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      try { if (code !== 0) throw new Error(stderr || `jobrun exited ${code}`); resolve(JSON.parse(stdout)); }
      catch (error) { reject(new InfrastructureError('windows_job_error', error.message)); }
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
// ott-run fallback when Job Objects are unavailable (or not Windows): runs the pupil's own bot directly on their own machine.
// shortcut: CPU time is estimated by wall time and memory is not limited; the classroom/official graders always use a real sandbox.
function runDirect(command, input, { cpuMs, wallMs, outputBytes }, cwd) {
  return new Promise((resolve, reject) => {
    const started = performance.now(), child = spawn(command[0], command.slice(1), { cwd, windowsHide: true, shell: false });
    let stdout = '', stderr = '', overflow = false, timedOut = false;
    const take = (text, chunk) => { if (Buffer.byteLength(text) + chunk.length > outputBytes) { overflow = true; return text; } return text + chunk; };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, wallMs);
    child.stdout.on('data', chunk => { stdout = take(stdout, chunk); }); child.stderr.on('data', chunk => { stderr = take(stderr, chunk).slice(-4096); });
    child.on('error', error => { clearTimeout(timer); reject(new InfrastructureError('direct_unavailable', `Không chạy được ${command[0]}: ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      const wall = Math.round(performance.now() - started);
      // An endless loop is by far the usual cause, and the real grader reports it as cpu_timeout.
      const fault = wall > cpuMs ? 'cpu_timeout' : timedOut ? 'wall_timeout' : overflow ? 'output_limit' : code !== 0 ? 'bot_crash' : null;
      resolve({ stdout, stderr, cpu_ms: wall, wall_ms: wall, exit_code: code ?? -1, fault });
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

class WindowsJobManager {
  // direct: ott-run fallback (see runDirect); otherwise every command runs inside a Job Object.
  constructor({ direct = false } = {}) {
    this.direct = direct; this.run = direct ? runDirect : execute;
    this.python = process.env.OTT_PYTHON || bundled('python/python.exe') || (process.platform === 'win32' ? 'python' : 'python3');
  }
  async findCompiler() {
    // MinGW g++ 12 uses ANSI paths: it cannot find cc1plus or headers under a folder such as "Tin học" (measured on WinLibs 12.2).
    if (process.platform === 'win32' && /[^ -~]/.test(`${ROOT}${CPP_INCLUDE || ''}`)) return { error: `Thư mục OTTv2 có dấu tiếng Việt (${ROOT}); g++ không chạy được ở đó. Chuyển cả thư mục sang đường dẫn không dấu, ví dụ D:\\OTTv2, để chấm C++.` };
    for (const candidate of [process.env.OTT_GXX, bundled('cpp/mingw64/bin/g++.exe'), 'g++', ...IDE_GXX].filter(Boolean)) {
      if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
      try { return { gxx: candidate, version: await exec(candidate, ['-dumpfullversion', '-dumpversion']) }; } catch { /* try the next one */ }
    }
    return null;
  }
  async check() {
    if (!this.direct && process.platform !== 'win32') throw new InfrastructureError('windows_job_unavailable', 'Backend windows-job chỉ chạy trên Windows.');
    if (!this.direct) await helper();
    const version = (await exec(this.python, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])']));
    const compiler = await this.findCompiler();
    this.cpp = compiler?.gxx ? compiler : null; this.cppError = compiler?.error || null;
    const image = `${this.direct ? 'direct' : 'windows-job'}:python-${version}${this.cpp ? `+g++-${this.cpp.version}` : ''}`;
    if (this.imageId && this.imageId !== image) throw new InfrastructureError('image_mismatch', `Máy chấm có môi trường ${image}, việc yêu cầu ${this.imageId}.`);
    this.imageId = image;
    return { available: true, backend: 'windows-job', experimental: true, warning: WARNING, image, cpp: this.cpp?.version || null, cppError: this.cppError };
  }
  async prepare(source) {
    if (!this.imageId) await this.check();
    if (source.language === 'cpp' && !this.cpp) throw new InfrastructureError('compiler_missing', this.cppError || 'Máy chủ lớp học chưa có g++: giải nén gói add-cpp vào thư mục OTTv2 (hoặc cài Dev-C++) rồi khởi động lại.');
    const staged = await stageSources(source);
    try {
      const units = source.language === 'cpp' ? (await fsp.readdir(staged.directory, { recursive: true })).filter(file => file.endsWith('.cpp')).sort() : [];
      // C++ gets a longer budget than Docker (20 s): classroom PCs are slow and json.hpp alone takes several seconds.
      const result = source.language === 'cpp'
        ? await this.run([this.cpp.gxx, '-O2', '-std=c++17', ...(process.platform === 'win32' ? ['-static'] : []), ...(CPP_INCLUDE ? [`-I${CPP_INCLUDE}`] : []), ...units, '-o', 'bot.exe'], '', { cpuMs: 60000, wallMs: 120000, memoryMb: 1024, outputBytes: 65536, processes: 8 }, staged.directory)
        : await this.run([this.python, '-I', '-B', '-c', COMPILER], '', { cpuMs: 20000, wallMs: 45000, memoryMb: 768, outputBytes: 65536 }, staged.directory);
      if (result.fault) throw new BotFault('compile_error', result.stderr || result.fault);
      return { ...staged, language: source.language, entry: source.entry, image: this.imageId, compile_cpu_ms: result.cpu_ms, compile_stderr: result.stderr };
    } catch (error) { await removeStage(staged.directory); throw error; }
  }
  // One helper process per move, like supervisor.py: no state survives between turns except userdata.
  async start(artifact) {
    const entry = path.join(artifact.directory, ...artifact.entry.split('/')), python = this.python, run = this.run;
    const command = artifact.language === 'cpp' ? [path.join(artifact.directory, 'bot.exe')] : [python, '-I', '-S', '-B', '-c', RUNNER, entry];
    let closed = false;
    return {
      async move(request) {
        if (closed) throw new InfrastructureError('session_closed');
        const limits = request.limits || LIMITS;
        const result = await run(command, JSON.stringify(request) + '\n',
          { cpuMs: limits.moveCpuMs, wallMs: limits.moveWallMs, memoryMb: limits.memoryMb, outputBytes: limits.outputBytes }, artifact.directory);
        if (result.fault) { const error = new BotFault(result.fault, result.stderr || result.fault); error.metrics = result; throw error; }
        return result;
      },
      async close() { closed = true; }
    };
  }
  async dispose(artifact) { await removeStage(artifact.directory); }
}
module.exports = { WindowsJobManager, WARNING, helper };
