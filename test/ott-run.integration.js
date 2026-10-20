// Run explicitly: npm run test:ott-run. Needs Python (OTT_PYTHON or python in PATH); the C++ case also needs g++ (OTT_GXX, cpp\ in the package, PATH).
// On Windows the bots run inside Job Objects, elsewhere directly (estimated CPU).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../scripts/ott-run');
const { WindowsJobManager } = require('../src/sandbox/windows-job');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-run-test-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const bot = (name, code) => { const file = path.join(dir, name); fs.writeFileSync(file, code); return file; };
async function run(file, ...args) {
  const lines = [], code = await main([file, '--no-open', '--games', '1', '--seed', 'ott-run-test', '--out', path.join(dir, `${path.basename(file)}.html`), ...args], line => lines.push(line));
  return { code, text: lines.join('\n') };
}
const reply = body => `import sys, json\nrequest = json.loads(sys.stdin.readline())\n${body}\n`;

test('sample template plays both sides and writes replay.html', async () => {
  const lines = [], code = await main([path.join(__dirname, '../bots/templates/python/main.py'), '--no-open', '--rules', 'powerups', '--out', path.join(dir, 'ok.html')], line => lines.push(line));
  assert.equal(code, 0, lines.join('\n'));
  const html = fs.readFileSync(path.join(dir, 'ok.html'), 'utf8');
  assert.match(html, /Ván 1 · bạn là Bên 0/); assert.match(html, /Ván 2 · bạn là Bên 1/);
});

test('crash, CPU loop, illegal move, bad output and banned import are explained in Vietnamese', async () => {
  const cases = [
    ['crash.py', reply('print(request["state"]["board"][99])'), /Chương trình bị dừng giữa trận[\s\S]*IndexError/],
    ['loop.py', reply('while True:\n    pass'), /tính quá lâu cho một nước|không trả lời kịp/],
    ['illegal.py', reply('print(json.dumps({"request_id": request["request_id"], "move": {"fromRow": 0, "fromCol": 0, "toRow": 0, "toCol": 0}}))'), /nước không được phép/],
    ['chatty.py', reply('print("xin chao")'), /không đọc được câu trả lời/],
    ['bai cua em.py', 'import subprocess\n', /bai cua em\.py dòng 1: không được dùng "subprocess"/]
  ];
  for (const [name, code, expected] of cases) {
    const result = await run(bot(name, code));
    assert.equal(result.code, 1, `${name}\n${result.text}`); assert.match(result.text, expected, name); assert.match(result.text, /Cách sửa:/, name);
  }
});

test('missing file and bad options exit 2 without a stack trace', async () => {
  assert.equal((await run(path.join(dir, 'khong-co.py'))).code, 2);
  assert.equal((await run(bot('x.py', reply('pass')), '--rules', 'khong-co')).code, 2);
});

test('C++ bot compiles and plays when g++ is available', async t => {
  const manager = new WindowsJobManager({ direct: process.platform !== 'win32' });
  if (!(await manager.check()).cpp) return t.skip('Chưa có g++');
  const { code, text } = await run(path.join(__dirname, '../bots/templates/cpp/main.cpp'), '--vs', 'cpp-greedy');
  assert.equal(code, 0, text); assert.match(text, /Biên dịch xong/);
  const broken = await run(bot('loi.cpp', 'int main( {'));
  assert.equal(broken.code, 1); assert.match(broken.text, /lỗi cú pháp hoặc biên dịch/);
});
