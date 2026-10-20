// Run explicitly on Windows: npm run test:windows-job. EXPERIMENTAL classroom backend (Job Objects): limits CPU, RAM,
// output and child processes; network and file access are NOT blocked (documented limitation, see docs/GRADERS.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { WindowsJobManager } = require('../src/sandbox/windows-job');
const { sampleSource } = require('../src/sandbox/samples');
const { GameEngine } = require('../src/game/engine');
const { LIMITS, makeRequest, parseResponse, BotFault } = require('../src/game/protocol');

const skip = process.platform !== 'win32' && 'Chỉ chạy trên Windows';
const manager = new WindowsJobManager();
const fixture = name => ({ language: 'python', entry: 'main.py', directory: path.resolve(__dirname, '../bots/fixtures', name) });
async function play(source, limits = LIMITS) {
  const artifact = await manager.prepare(source);
  try { const session = await manager.start(artifact); return await session.move(makeRequest(new GameEngine({ seed: 'windows-job' }), limits)); }
  finally { await manager.dispose(artifact); }
}

test('helper builds with csc.exe, reports an experimental Python environment and plays a legal move', { skip }, async () => {
  const info = await manager.check();
  assert.equal(info.backend, 'windows-job'); assert.equal(info.experimental, true); assert.match(info.warning, /chưa chặn mạng/);
  assert.match(info.image, /^windows-job:python-\d+\.\d+\.\d+(\+g\+\+-[\d.]+)?$/);
  const result = await play(sampleSource('python-greedy'));
  assert.ok(parseResponse(result.stdout, { request_id: 'turn-0' }).move); assert.ok(result.cpu_ms > 0);
});

test('Job Object stops crash, CPU loop, wall sleep, memory, output flood and child processes', { skip }, async () => {
  const hidden = `import sys\nm=__builtins__.__dict__['__imp'+'ort__']\nm('sub'+'process').run(['cmd','/c','echo CHILD_RAN'])\nprint('UNEXPECTED_CHILD', file=sys.stderr)\n`;
  const cases = [[fixture('crash'), 'bot_crash'], [fixture('loop'), 'cpu_timeout'], [fixture('sleep'), 'wall_timeout'], [fixture('memory'), 'bot_crash', 'MEMORY_DENIED'], [fixture('output'), 'output_limit'], [fixture('fork'), 'bot_crash']];
  const fs = require('node:fs/promises'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-jobchild-'));
  await fs.writeFile(path.join(dir, 'main.py'), hidden);
  cases.push([{ language: 'python', entry: 'main.py', directory: dir }, 'bot_crash']);
  try {
    for (const [source, code, marker] of cases) {
      await assert.rejects(play(source), error => {
        assert.ok(error instanceof BotFault, `${source.directory}: ${error}`); assert.equal(error.code, code, source.directory);
        if (marker) assert.ok(error.metrics.stderr.includes(marker), error.metrics.stderr);
        assert.ok(!error.metrics.stdout.includes('CHILD_RAN') && !error.metrics.stderr.includes('UNEXPECTED_CHILD'));
        console.log(`${path.basename(source.directory)}: ${error.code}, CPU ${error.metrics.cpu_ms}ms`);
        return true;
      });
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

// C++ needs g++ (classroom package: add-cpp.zip; or OTT_GXX / Dev-C++ / PATH). Without it, C++ is an infrastructure limit, not the bot's fault.
test('C++ without g++ is refused as an infrastructure limit', { skip }, async t => {
  if ((await manager.check()).cpp) return t.skip('Máy này có g++');
  await assert.rejects(manager.prepare(sampleSource('cpp-greedy')), { code: 'compiler_missing' });
});
test('C++ compiles with g++ and plays; compile error, crash, CPU loop and child process are bot faults', { skip }, async t => {
  if (!(await manager.check()).cpp) return t.skip('Chưa có g++ (đặt OTT_GXX hoặc giải nén add-cpp)');
  const result = await play(sampleSource('cpp-greedy'));
  assert.ok(parseResponse(result.stdout, { request_id: 'turn-0' }).move);
  const fs = require('node:fs/promises'), os = require('node:os'), dirs = [];
  const bot = async body => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-jobcpp-')); dirs.push(dir); await fs.writeFile(path.join(dir, 'main.cpp'), body); return { language: 'cpp', entry: 'main.cpp', directory: dir }; };
  try {
    await assert.rejects(manager.prepare(await bot('int main( {')), { code: 'compile_error' });
    for (const [body, code] of [['int main(){int*p=nullptr;return *p;}', 'bot_crash'], ['int main(){volatile unsigned long x=0;for(;;)x++;}', 'cpu_timeout'],
      ['#include <cstdlib>\n#include <cstdio>\nint main(){int r=std::system("cmd /c echo CHILD_RAN");std::printf("UNEXPECTED %d",r);return 1;}', 'bot_crash']]) {
      await assert.rejects(play(await bot(body)), error => {
        assert.ok(error instanceof BotFault, String(error)); assert.equal(error.code, code, body);
        assert.ok(!error.metrics.stdout.includes('CHILD_RAN'), error.metrics.stdout);
        return true;
      });
    }
  } finally { for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true }); }
});
test.todo('Chặn mạng và đọc file trên windows-job — chưa hỗ trợ, đã ghi trong D13');
