// Try a bot on your own computer before submitting: same engine, protocol, rules, limits and static scan as the grader,
// games against a sample bot (sides alternate), a Vietnamese explanation of any error and an offline replay.html.
//   node scripts/ott-run.js <main.py | main.cpp | bot.zip> [--vs python-greedy | cpp-greedy | <file>] [--rules classic | obstacles | powerups | <rules.json>]
//                           [--games 2] [--seed text] [--out <replay.html>] [--no-open]
// Exit code: 0 your bot played every game correctly, 1 your bot has an error, 2 cannot run (missing Python/g++, bad arguments).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DEFAULT_RULES } = require('../src/game/engine');
const { validateEngineRules } = require('../src/game/registry');
const { runMatch } = require('../src/game/match');
const { BotFault, LIMITS } = require('../src/game/protocol');
const { extractSource, scanSource } = require('../src/submissions/source');
const { SAMPLES, sampleSource } = require('../src/sandbox/samples');
const { WindowsJobManager } = require('../src/sandbox/windows-job');
const { explain } = require('../web/hints');
const { replayHtml } = require('../src/replay-html');

const RULES = { classic: DEFAULT_RULES, obstacles: require('../rules/obstacles.json'), powerups: require('../rules/powerups.json') };
const REASONS = { reached_home: 'chiếm nhà đối thủ', eliminated: 'ăn hết quân đối thủ', no_legal_moves: 'đối thủ hết nước đi', repetition: 'lặp thế cờ', move_limit: 'hết số nước', material: 'hết số nước, so số quân' };
const usage = 'Cách dùng: ott-run <main.py | main.cpp | bot.zip> [--vs python-greedy|cpp-greedy|<file>] [--rules classic|obstacles|powerups|<file.json>] [--games 2] [--seed chữ] [--out replay.html] [--no-open]';
class UsageError extends Error {}

function parseArgs(argv) {
  const options = { vs: 'python-greedy', rules: 'classic', games: 2, seed: null, out: null, open: true, file: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], value = () => { if (i + 1 >= argv.length) throw new UsageError(`Thiếu giá trị sau ${arg}.`); return argv[++i]; };
    if (arg === '--vs') options.vs = value();
    else if (arg === '--rules') options.rules = value();
    else if (arg === '--games') options.games = Number(value());
    else if (arg === '--seed') options.seed = value();
    else if (arg === '--out') options.out = value();
    else if (arg === '--no-open') options.open = false;
    else if (arg.startsWith('--')) throw new UsageError(`Không hiểu tùy chọn ${arg}.`);
    else if (!options.file) options.file = arg;
    else throw new UsageError(`Chỉ chạy một bot mỗi lần (thừa "${arg}").`);
  }
  if (!options.file) throw new UsageError('Chưa chọn file bot.');
  if (!Number.isInteger(options.games) || options.games < 1 || options.games > 10) throw new UsageError('--games từ 1 đến 10.');
  return options;
}
function loadRules(name) {
  const known = RULES[name] || Object.values(RULES).find(rules => rules.id === name);
  if (known) return known;
  if (!fs.existsSync(name)) throw new UsageError(`Không có bộ luật "${name}". Chọn classic, obstacles, powerups hoặc đường dẫn file .json.`);
  try { return validateEngineRules(JSON.parse(fs.readFileSync(name, 'utf8'))); } catch (error) { throw new UsageError(`File luật ${name} không hợp lệ: ${error.message}`); }
}
// Single files are copied as main.py/main.cpp: pupils' file names often have spaces or Vietnamese letters.
async function loadBot(file, directory) {
  const extension = path.extname(file).toLowerCase();
  if (!['.py', '.cpp', '.zip'].includes(extension)) throw new BotFault('unsupported_source', 'Chọn file .py, .cpp hoặc .zip.');
  let buffer; try { buffer = await fsp.readFile(file); } catch { throw new UsageError(`Không mở được file ${file}.`); }
  const source = await extractSource({ buffer, filename: extension === '.zip' ? 'bot.zip' : `main${extension}`, directory });
  try { await scanSource(source); }
  catch (error) { if (extension !== '.zip' && error instanceof BotFault) error.message = error.message.replace(/^main\.(py|cpp)/, path.basename(file)); throw error; }
  return source;
}
async function chooseManager(log) {
  if (process.platform === 'win32') {
    const manager = new WindowsJobManager();
    try { await manager.check(); return manager; } catch (error) { log(`Không dùng được Job Object của Windows (${error.message}).`); }
  }
  const manager = new WindowsJobManager({ direct: true });
  await manager.check();
  log('Lưu ý: bot chạy trực tiếp trên máy này. Giới hạn CPU chỉ ước lượng theo thời gian thực; bộ nhớ không bị giới hạn.');
  return manager;
}
const describe = (replay, side) => {
  const result = replay.result, outcome = result.winner === null ? 'HÒA' : result.winner === side ? 'THẮNG' : 'THUA';
  const reason = REASONS[result.winReason] || `bot bên ${replay.fault?.player} lỗi (${result.winReason})`;
  const cpu = replay.turns.filter(turn => turn.player === side).map(turn => turn.cpu_ms);
  return `${outcome} · ${reason} · ${replay.turns.length} nước · bot của bạn tính lâu nhất ${Math.round(Math.max(0, ...cpu))} ms/nước (giới hạn ${replay.limits.moveCpuMs} ms)`;
};
function printError(log, code, message) {
  const hint = explain(code, message);
  log(`\n✗ ${hint.title}\n  Cách sửa: ${hint.fix}${hint.detail ? `\n  Chi tiết: ${hint.detail}` : ''}`);
}
function openFile(file) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  try { spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); } catch { /* the path is printed anyway */ }
}

async function main(argv = process.argv.slice(2), log = console.log) {
  let options;
  try { options = parseArgs(argv); } catch (error) { if (error instanceof UsageError) { log(`${error.message}\n${usage}`); return 2; } throw error; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ott-run-')), sessions = [], artifacts = [];
  let manager;
  try {
    const rules = loadRules(options.rules), file = path.resolve(options.file);
    log(`Bot: ${file}\nĐối thủ: ${options.vs} · Bộ luật: ${rules.name || rules.id} · ${options.games} ván`);
    const mine = await loadBot(file, path.join(work, 'mine'));
    log(`✓ Kiểm tra mã nguồn (${mine.language === 'cpp' ? 'C++' : 'Python'}): không dùng thư viện/lệnh bị cấm.`);
    const opponent = Object.hasOwn(SAMPLES, options.vs) ? sampleSource(options.vs) : await loadBot(path.resolve(options.vs), path.join(work, 'opponent')).catch(error => {
      throw error instanceof BotFault ? new UsageError(`Bot đối thủ ${options.vs} không dùng được: ${explain(error.code, error.message).title}`) : error; });
    manager = await chooseManager(log);
    const candidate = await manager.prepare({ ...mine, id: 'ban' }); artifacts.push(candidate);
    log(`✓ ${mine.language === 'cpp' ? 'Biên dịch' : 'Kiểm tra cú pháp'} xong.`);
    const reference = await manager.prepare({ ...opponent, id: 'doi-thu' }); artifacts.push(reference);
    const seed = options.seed || `ott-run-${Date.now().toString(36)}`, games = [];
    let failed = false;
    for (let index = 0; index < options.games; index++) {
      const side = index % 2, ordered = side === 0 ? [candidate, reference] : [reference, candidate];
      try {
        for (const artifact of ordered) sessions.push(await manager.start(artifact, LIMITS));
        const replay = await runMatch({ seed: `${seed}-${index + 1}`, rules, bots: [0, 1].map(p => ({ id: p === side ? 'bot của bạn' : options.vs })), choose: (player, request) => sessions[player].move(request) });
        const summary = describe(replay, side);
        log(`Ván ${index + 1} (bạn là Bên ${side}): ${summary}`);
        games.push({ title: `Ván ${index + 1} · bạn là Bên ${side}`, summary, replay });
        if (replay.fault?.player === side) { failed = true; printError(log, replay.fault.code, replay.fault.stderr || replay.fault.message); }
        else if (replay.fault) log(`  (Bot đối thủ gặp lỗi ${replay.fault.code}; ván này không nói lên bot của bạn sai.)`);
      } finally { await Promise.allSettled(sessions.splice(0).map(session => session.close())); }
    }
    const out = path.resolve(options.out || path.join(path.dirname(file), 'replay.html'));
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, replayHtml({ title: `Chạy thử ${path.basename(file)}`, games }));
    log(`\nĐã lưu bản xem lại: ${out}`);
    if (options.open) openFile(out);
    log(failed ? 'Bot của bạn còn lỗi: sửa theo gợi ý ở trên rồi chạy lại.' : 'Bot chạy đúng luật trong giới hạn thời gian. Có thể nộp bài (thắng hay thua bot mẫu không bắt buộc).');
    return failed ? 1 : 0;
  } catch (error) {
    if (error instanceof BotFault) { printError(log, error.code, error.message); return 1; }
    if (error instanceof UsageError) { log(error.message); return 2; }
    if (error.code === 'compiler_missing') { printError(log, error.code, error.message); log(`  Máy này: ${error.message}`); return 2; }
    log(`\nKhông chạy được: ${error.message}`);
    return 2;
  } finally {
    for (const artifact of artifacts) await manager.dispose(artifact).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true });
  }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, parseArgs };
