const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const { BotFault } = require('../game/protocol');
const UPLOAD_LIMIT = 5 * 1024 * 1024;
const FILE_LIMIT = 1024 * 1024;
const REPO_ARCHIVE_LIMIT = 50 * 1024 * 1024;
const MANIFEST_LIMIT = 4096;
const fail = (code, message) => { throw new BotFault(code, message); };

function safeName(name) {
  if (typeof name !== 'string' || name.length > 180 || name.includes('\\') || name.startsWith('/') || name.includes(':')) fail('unsafe_path', 'Đường dẫn trong bài nộp không an toàn.');
  const clean = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = clean.split('/');
  if (!clean || parts.length > 8 || parts.some(part => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) || part.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('unsafe_path', 'Tên file/thư mục không hợp lệ (chỉ dùng chữ, số, _, -, .).');
  return clean;
}
function sourceLanguage(names) {
  if (!names.length) fail('empty_source', 'Bài nộp không có source.');
  if (names.every(n => n.endsWith('.py'))) return 'python';
  if (names.every(n => /\.(cpp|h|hpp)$/.test(n)) && names.some(n => n.endsWith('.cpp'))) return 'cpp';
  fail('unsupported_source', 'Chỉ nhận Python (.py) hoặc C++ (.cpp, .h, .hpp), không trộn hai ngôn ngữ.');
}
function chooseEntry(names, language, requested) {
  if (requested) {
    const entry = safeName(requested);
    if (!names.includes(entry) || !entry.endsWith(language === 'python' ? '.py' : '.cpp')) fail('invalid_entry', 'File chạy chính không có trong bài nộp hoặc sai ngôn ngữ.');
    return entry;
  }
  const main = language === 'python' ? 'main.py' : 'main.cpp';
  if (names.includes(main)) return main;
  const candidates = names.filter(n => path.posix.basename(n) === main);
  if (candidates.length === 1) return candidates[0];
  const executable = names.filter(n => n.endsWith(language === 'python' ? '.py' : '.cpp'));
  if (executable.length === 1) return executable[0];
  fail('entry_required', 'ZIP có nhiều file: hãy chỉ rõ file chạy chính, ví dụ main.py hoặc main.cpp.');
}

// select(fileName) returns null to skip an entry, {name} to extract it, or {manifest:true} to read ott.json.
async function unpackZip(buffer, directory, { select = name => ({ name }), entryLimit = 128 } = {}) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(new BotFault('invalid_zip', 'Không đọc được file ZIP.')) : resolve(value)));
  const names = [], seen = new Set(); let entries = 0, declared = 0, actual = 0, manifest = null;
  try {
    await new Promise((resolve, reject) => {
      let finished = false;
      const stop = error => { if (finished) return; finished = true; zip.close(); reject(error instanceof BotFault ? error : new BotFault('invalid_zip', 'ZIP lỗi hoặc kích thước giải nén không hợp lệ.')); };
      zip.on('error', stop);
      zip.on('end', () => { if (!finished) { finished = true; resolve(); } });
      zip.on('entry', entry => {
        (async () => {
          if (++entries > entryLimit) fail('zip_entry_limit', `ZIP có quá nhiều mục (tối đa ${entryLimit}).`);
          const picked = select(entry.fileName);
          if (!picked) { zip.readEntry(); return; }
          const name = picked.manifest ? 'ott.json' : safeName(picked.name), key = name.toLowerCase();
          if (seen.has(key)) fail('zip_duplicate', 'ZIP có đường dẫn trùng nhau.');
          seen.add(key);
          if (entry.generalPurposeBitFlag & 1) fail('encrypted_zip', 'Không nhận ZIP có mật khẩu.');
          if (![0, 8].includes(entry.compressionMethod)) fail('zip_compression', 'ZIP chỉ hỗ trợ Store hoặc Deflate.');
          const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (kind && ![0x8000, 0x4000].includes(kind)) fail('zip_special_file', 'ZIP không được chứa symlink hoặc file thiết bị.');
          if (picked.manifest) {
            if (kind === 0x4000 || entry.uncompressedSize > MANIFEST_LIMIT) fail('manifest_invalid', 'ott.json phải là file tối đa 4 KiB.');
            const stream = await new Promise((ok, bad) => zip.openReadStream(entry, (error, value) => error ? bad(error) : ok(value)));
            const chunks = []; let length = 0;
            for await (const chunk of stream) { length += chunk.length; if (length > MANIFEST_LIMIT) { stream.destroy(); fail('manifest_invalid', 'ott.json phải là file tối đa 4 KiB.'); } chunks.push(chunk); }
            manifest = Buffer.concat(chunks); zip.readEntry(); return;
          }
          if (entry.fileName.endsWith('/')) { if (entry.uncompressedSize !== 0) fail('invalid_zip', 'Thư mục ZIP chứa dữ liệu.'); zip.readEntry(); return; }
          if (kind === 0x4000) fail('invalid_zip', 'Metadata thư mục không hợp lệ.');
          if (!/\.(py|cpp|h|hpp)$/.test(name)) fail('unsupported_source', 'ZIP chỉ được chứa file mã nguồn C++ hoặc Python.');
          if (names.length >= 64 || entry.uncompressedSize > FILE_LIMIT || (declared += entry.uncompressedSize) > UPLOAD_LIMIT || entry.uncompressedSize > Math.max(1, entry.compressedSize) * 100) fail('zip_bomb', 'ZIP vượt giới hạn: 64 file, 1 MiB/file, 5 MiB giải nén hoặc tỉ lệ nén 100×.');
          const stream = await new Promise((ok, bad) => zip.openReadStream(entry, (error, value) => error ? bad(error) : ok(value)));
          const chunks = []; let length = 0;
          for await (const chunk of stream) {
            length += chunk.length; actual += chunk.length;
            if (length > FILE_LIMIT || actual > UPLOAD_LIMIT || length > entry.uncompressedSize) { stream.destroy(); fail('zip_bomb', 'Dữ liệu giải nén vượt giới hạn.'); }
            chunks.push(chunk);
          }
          if (length !== entry.uncompressedSize) fail('invalid_zip', 'Kích thước ZIP không khớp dữ liệu.');
          const destination = path.resolve(directory, ...name.split('/'));
          if (!destination.startsWith(path.resolve(directory) + path.sep)) fail('unsafe_path', 'Đường dẫn vượt thư mục bài nộp.');
          await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
          await fs.writeFile(destination, Buffer.concat(chunks), { flag: 'wx', mode: 0o644 });
          names.push(name); zip.readEntry();
        })().catch(stop);
      });
      zip.readEntry();
    });
    names.sort();
    return Object.assign(names, { manifest });
  } finally { zip.close(); }
}

async function extractSource({ buffer, filename, entry, directory }) {
  if (!Buffer.isBuffer(buffer) || buffer.length > UPLOAD_LIMIT) fail('upload_limit', 'Bài nộp vượt 5 MiB.');
  const name = safeName(filename);
  if (name.includes('/') || !/\.(cpp|py|zip)$/.test(name)) fail('unsupported_source', 'Nộp một file .cpp, .py hoặc .zip.');
  await fs.mkdir(directory, { recursive: true, mode: 0o755 });
  let names;
  if (name.endsWith('.zip')) names = await unpackZip(buffer, directory);
  else {
    if (buffer.length > FILE_LIMIT) fail('source_file_limit', 'Một file mã nguồn không được vượt 1 MiB.');
    await fs.writeFile(path.join(directory, name), buffer, { flag: 'wx', mode: 0o644 }); names = [name];
  }
  const language = sourceLanguage(names);
  return { language, entry: chooseEntry(names, language, entry), names, directory };
}

// GitHub zipballs wrap the tree in one "owner-repo-sha/" folder; only ott.json and source files under bot/ are extracted.
async function extractRepo({ buffer, directory }) {
  if (!Buffer.isBuffer(buffer) || buffer.length > REPO_ARCHIVE_LIMIT) fail('repo_too_large', 'Bản nén repo vượt 50 MB.');
  await fs.mkdir(directory, { recursive: true, mode: 0o755 });
  let prefix = null;
  const select = fileName => {
    const slash = fileName.indexOf('/'), top = slash < 0 ? fileName : fileName.slice(0, slash + 1);
    if (prefix === null) prefix = top;
    else if (top !== prefix) fail('invalid_zip', 'Bản nén repo có cấu trúc không hợp lệ.');
    const relative = fileName.slice(prefix.length);
    if (relative === 'ott.json') return { manifest: true };
    if (!relative.startsWith('bot/') || relative.endsWith('/') || !/\.(py|cpp|h|hpp)$/.test(relative)) return null;
    return { name: relative.slice(4) };
  };
  const names = await unpackZip(buffer, directory, { select, entryLimit: 20000 });
  if (!names.manifest) fail('manifest_missing', 'Thiếu file ott.json ở thư mục gốc repo.');
  let config;
  try { config = JSON.parse(names.manifest.toString('utf8')); } catch { fail('manifest_invalid', 'ott.json không phải JSON hợp lệ.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) || !['python', 'cpp'].includes(config.language) || typeof config.entry !== 'string' || !config.entry)
    fail('manifest_invalid', 'ott.json cần dạng {"language": "python" hoặc "cpp", "entry": "main.py"}; entry tính từ thư mục bot/.');
  if (!names.length) fail('empty_source', 'Thư mục bot/ trong repo không có file mã nguồn .py/.cpp.');
  const files = [...names], language = sourceLanguage(files);
  if (language !== config.language) fail('manifest_invalid', `ott.json khai báo ${config.language} nhưng thư mục bot/ chứa mã ${language}.`);
  return { language, entry: chooseEntry(files, language, config.entry), names: files, directory };
}

async function scanSource(source, extraScanner) {
  const deniedModules = /^(os|posix|nt|socket|subprocess|ctypes|multiprocessing|threading|_thread|resource|pty|fcntl|mmap|importlib|pickle|marshal|shutil|pathlib|http|urllib|ssl|requests|builtins)(\.|$)/;
  for (const name of source.names) {
    const text = await fs.readFile(path.join(source.directory, name), 'utf8');
    if (text.includes('\0')) fail('binary_source', `File mã nguồn chứa byte NUL không hợp lệ: ${name}`);
    // Line by line so the message can point at the line to fix; comments are blanked but keep their newlines.
    const lines = (source.language === 'python' ? text.replace(/#[^\n]*/g, '') : text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, '')).replace(/\/\/[^\n]*/g, '')).split('\n');
    lines.forEach((code, index) => {
      let banned;
      if (source.language === 'python') {
        const imports = [...code.matchAll(/\bfrom\s+([\w.]+)\s+import\b/g)].map(match => match[1]);
        for (const match of code.matchAll(/(?:^|;)\s*import\s+([^;]+)/g)) imports.push(...match[1].split(',').map(item => item.trim().split(/\s+/)[0]));
        banned = imports.find(module => deniedModules.test(module)) || code.match(/\b(__import__|eval|exec|compile|open)\s*\(/)?.[1];
      } else {
        banned = [...code.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)].map(match => match[1]).find(include => /^(\/|\.\.|sys\/|linux\/|windows|winsock|unistd|process|pthread|thread|future|filesystem|fstream|dlfcn)/i.test(include))
          || code.match(/\b(system|fork|vfork|clone|socket|connect|bind|listen|accept|popen|fopen|freopen|open|ptrace|mmap|exec\w*|__asm__|asm)\s*\(/)?.[1];
      }
      if (banned) fail('static_scan', `${name} dòng ${index + 1}: không được dùng "${banned}" (${source.language === 'python' ? 'thư viện hoặc hàm' : 'thư viện hoặc lệnh'} bị cấm trong giải).`);
    });
  }
  if (extraScanner) await extraScanner(source);
}
module.exports = { UPLOAD_LIMIT, FILE_LIMIT, REPO_ARCHIVE_LIMIT, safeName, extractSource, extractRepo, scanSource };
