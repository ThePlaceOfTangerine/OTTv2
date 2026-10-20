// Classroom package for school computer rooms (no admin rights, frozen C: drive): unzip anywhere (USB, D:\) and double-click start.bat.
//   npm run package:classroom -- --python <python-3.11.x-embed-amd64.zip> --json <nlohmann json.hpp> [--mingw <WinLibs mingw64 folder>] [--out <folder>]
// Output: OTTv2-lop-hoc.zip (Node + app + Python 3.11 embeddable, sandbox windows-job) and, with --mingw, OTTv2-add-cpp.zip
// (a trimmed g++ to unzip into the same folder). Downloads are inputs: verify them first (docs/LOP-HOC.md).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2), arg = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
// Windows' own bsdtar reads and writes .zip; Git Bash's GNU tar does not.
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const APP = ['server.js', 'package.json', 'package-lock.json', 'README.md', 'src', 'web', 'web-public', 'public', 'rules', 'docs', 'scripts', 'node_modules',
  'sandbox/windows', 'bots/templates', 'bots/python-greedy', 'bots/cpp-greedy'];
const SKIP = /(^|[\\/])(__pycache__|\.git)([\\/]|$)|\.(sqlite|sqlite-wal|sqlite-shm|log|tmp)$|jobrun-[0-9a-f]+\.exe$/;

const START = `@echo off
rem OTTv2 - goi lop hoc. Bam dup de chay; dong cua so nay de tat may chu.
rem Khong dung chcp 65001: no lam hong duong dan co dau. Node tu in tieng Viet ra cua so.
cd /d "%~dp0"
if not defined OTT_NO_BROWSER set "OTT_OPEN_BROWSER=1"
:run
node\\node.exe --no-warnings server.js
rem 75 = khoi dong lai sau khi cai dat (wizard) hoac doi muc tin cay.
if %errorlevel%==75 (set "OTT_OPEN_BROWSER=" & goto run)
echo.
echo May chu da dung. Neu co loi o tren, chup man hinh gui giao vien phu trach.
pause
`;
// Drag a bot file onto it: ott-run against the sample bot, then replay.html opens next to the bot file.
const TRY = `@echo off
rem OTTv2 - chay thu bot. Keo file main.py hoac main.cpp tha vao file nay.
if "%~1"=="" (
  echo Keo file main.py hoac main.cpp cua ban tha vao chay-thu.bat de chay thu.
  pause
  exit /b 2
)
cd /d "%~dp0"
node\\node.exe --no-warnings scripts\\ott-run.js "%~1" %2 %3 %4 %5 %6 %7 %8
echo.
pause
`;
const QUICK = `OTTv2 - GOI LOP HOC (Windows 10/11, khong can cai dat, khong can quyen quan tri)

1. Giai nen ca thu muc vao USB hoac o D:\\ (KHONG de o C:\\ neu phong may co Deep Freeze/dong bang o). Dat ten thu muc KHONG DAU (vi du D:\\OTTv2): g++ khong chay duoc trong thu muc co dau.
2. Bam dup start.bat. Trinh duyet tu mo trang cai dat lan dau (hoac mo http://127.0.0.1:3000/admin).
3. Lam theo 3 buoc tren trang: tao tai khoan giao vien, chon muc tin cay, nhap danh sach lop (tuy chon).
4. Muon tat may chu: dong cua so den. Du lieu nam trong thu muc data\\ ben canh start.bat: sao chep thu muc nay de sao luu.

HOC SINH CHAY THU BOT (khong can may chu, khong can mang): keo file main.py hoac main.cpp tha vao chay-thu.bat.
Bot dau 2 van voi bot mau, cua so den bao loi bang tieng Viet, trinh duyet mo replay.html (luu canh file bot) de xem lai tung nuoc.

Lop hoc C++: neu may chua co Dev-C++/Code::Blocks, giai nen OTTv2-add-cpp.zip vao chinh thu muc nay (tao ra thu muc cpp\\), roi chay lai start.bat.
Che do lop hoc KHONG chan mang va file cua bot: chi dung khi co giao vien giam sat; ket qua khong chinh thuc.
Huong dan day du: docs\\LOP-HOC.md
`;
// Only what g++ needs to build a static C++17 bot (about a fifth of WinLibs).
function trimMingw(source, target) {
  const triple = 'x86_64-w64-mingw32', version = fs.readdirSync(path.join(source, 'lib/gcc', triple))[0];
  const copy = (relative, filter) => { if (!fs.existsSync(path.join(source, relative))) throw new Error(`Thiếu ${relative} trong ${source}`); fs.cpSync(path.join(source, relative), path.join(target, relative), { recursive: true, filter: filter && (file => fs.statSync(file).isDirectory() || filter(path.basename(file))) }); };
  const dlls = name => name.endsWith('.dll');
  // DLL imports checked with objdump -p (WinLibs 12.2): cc1plus/as/ld carry their own DLLs next to them.
  for (const file of ['g++.exe', 'libiconv-2.dll', 'libwinpthread-1.dll']) copy(`bin/${file}`);
  copy(`libexec/gcc/${triple}/${version}`, name => ['cc1plus.exe', 'collect2.exe', 'lto-wrapper.exe'].includes(name) || dlls(name));
  copy(`lib/gcc/${triple}/${version}`, name => /^(crt.*\.o|libgcc(_eh)?\.a)$/.test(name) || !/\.(a|o|exe|dll|py)$/.test(name) && !['plugin', 'finclude', 'install-tools', 'adainclude', 'adalib'].includes(name));
  for (const lib of ['libstdc++.a', 'libsupc++.a', 'libstdc++fs.a', 'libssp.a', 'libssp_nonshared.a', 'libatomic.a', 'libquadmath.a', 'libgcc_s.a']) copy(`lib/${lib}`);
  copy('include/c++');
  copy(`${triple}/include`);
  copy(`${triple}/bin`, name => ['as.exe', 'ld.exe'].includes(name) || dlls(name));
  copy(`${triple}/lib`, name => name.endsWith('.o') || /^lib(mingw32|mingwex|moldname|msvcrt|msvcrt-os|ucrt|ucrtbase|kernel32|user32|advapi32|shell32|gdi32|pthread|winpthread|m|psapi)\.a$/.test(name));
  for (const file of ['version_info.txt', 'licenses']) if (fs.existsSync(path.join(source, file))) copy(file);
  fs.writeFileSync(path.join(target, '..', 'PHIEN-BAN.txt'), `g++ ${version} (WinLibs, rút gọn cho OTTv2). Máy chấm giải chính thức dùng g++ 12 trên Linux.\n`);
}
function zip(folder, name, out) {
  const file = path.join(out, name);
  fs.rmSync(file, { force: true });
  // Relative names + cwd: tar.exe takes ANSI arguments and breaks on Vietnamese folder names.
  execFileSync(TAR, ['-a', '-c', '-f', path.relative(path.dirname(folder), file), path.basename(folder)], { cwd: path.dirname(folder) });
  const size = fs.statSync(file).size, hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  console.log(`${file}  ${(size / 1048576).toFixed(1)} MB  sha256 ${hash}`);
}

async function main() {
  const out = path.resolve(arg('out') || path.join(ROOT, 'dist')), python = arg('python'), json = arg('json'), mingw = arg('mingw');
  if (process.platform !== 'win32') throw new Error('Gói lớp học được đóng trên Windows (cần csc.exe và tar.exe của Windows).');
  if (!python || !json) throw new Error('Cần --python <python-3.11.x-embed-amd64.zip> và --json <json.hpp>. Xem docs/LOP-HOC.md.');
  const stage = path.join(out, 'OTTv2-lop-hoc');
  fs.rmSync(stage, { recursive: true, force: true });
  for (const entry of APP) fs.cpSync(path.join(ROOT, entry), path.join(stage, entry), { recursive: true, filter: file => !SKIP.test(path.relative(ROOT, file)) });
  fs.mkdirSync(path.join(stage, 'node')); fs.copyFileSync(process.execPath, path.join(stage, 'node/node.exe'));
  fs.mkdirSync(path.join(stage, 'python')); fs.copyFileSync(path.resolve(python), path.join(stage, 'python/embed.zip'));
  execFileSync(TAR, ['-x', '-f', 'embed.zip'], { cwd: path.join(stage, 'python') }); fs.rmSync(path.join(stage, 'python/embed.zip'));
  if (!fs.existsSync(path.join(stage, 'python/python.exe'))) throw new Error(`${python} không phải gói Python embeddable.`);
  fs.mkdirSync(path.join(stage, 'vendor/include/nlohmann'), { recursive: true }); fs.copyFileSync(path.resolve(json), path.join(stage, 'vendor/include/nlohmann/json.hpp'));
  // Prebuilt Job Object helper: school PCs then never need to compile it (and C:\ temp is wiped on reboot anyway).
  const helper = await require('../src/sandbox/windows-job').helper();
  fs.copyFileSync(helper, path.join(stage, 'sandbox/windows', path.basename(helper)));
  fs.mkdirSync(path.join(stage, 'data'));
  fs.writeFileSync(path.join(stage, 'start.bat'), START.replace(/\n/g, '\r\n'));
  fs.writeFileSync(path.join(stage, 'chay-thu.bat'), TRY.replace(/\n/g, '\r\n'));
  fs.writeFileSync(path.join(stage, 'DOC-TRUOC.txt'), QUICK.replace(/\n/g, '\r\n'));
  zip(stage, 'OTTv2-lop-hoc.zip', out);
  if (mingw) {
    const cpp = path.join(out, 'add-cpp', 'cpp');
    fs.rmSync(path.dirname(cpp), { recursive: true, force: true });
    trimMingw(path.resolve(mingw), path.join(cpp, 'mingw64'));
    zip(cpp, 'OTTv2-add-cpp.zip', out);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
