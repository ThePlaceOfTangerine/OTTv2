const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const { BotFault } = require('../game/protocol');
const UPLOAD_LIMIT = 5 * 1024 * 1024;
const FILE_LIMIT = 1024 * 1024;
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

async function unpackZip(buffer, directory) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(new BotFault('invalid_zip', 'Không đọc được file ZIP.')) : resolve(value)));
  const names = [], seen = new Set(); let entries = 0, declared = 0, actual = 0;
  try {
    await new Promise((resolve, reject) => {
      let finished = false;
      const stop = error => { if (finished) return; finished = true; zip.close(); reject(error instanceof BotFault ? error : new BotFault('invalid_zip', 'ZIP lỗi hoặc kích thước giải nén không hợp lệ.')); };
      zip.on('error', stop);
      zip.on('end', () => { if (!finished) { finished = true; resolve(); } });
      zip.on('entry', entry => {
        (async () => {
          if (++entries > 128) fail('zip_entry_limit', 'ZIP có quá nhiều mục (tối đa 128).');
          const name = safeName(entry.fileName), key = name.toLowerCase();
          if (seen.has(key)) fail('zip_duplicate', 'ZIP có đường dẫn trùng nhau.');
          seen.add(key);
          if (entry.generalPurposeBitFlag & 1) fail('encrypted_zip', 'Không nhận ZIP có mật khẩu.');
          if (![0, 8].includes(entry.compressionMethod)) fail('zip_compression', 'ZIP chỉ hỗ trợ Store hoặc Deflate.');
          const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (kind && ![0x8000, 0x4000].includes(kind)) fail('zip_special_file', 'ZIP không được chứa symlink hoặc file thiết bị.');
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
    return names.sort();
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

async function scanSource(source, extraScanner) {
  const deniedModules = /^(os|posix|nt|socket|subprocess|ctypes|multiprocessing|threading|_thread|resource|pty|fcntl|mmap|importlib|pickle|marshal|shutil|pathlib|http|urllib|ssl|requests|builtins)(\.|$)/;
  for (const name of source.names) {
    const text = await fs.readFile(path.join(source.directory, name), 'utf8');
    if (text.includes('\0')) fail('binary_source', `File mã nguồn chứa byte NUL không hợp lệ: ${name}`);
    if (source.language === 'python') {
      const code = text.replace(/#[^\n]*/g, '');
      const imports = [...code.matchAll(/\bfrom\s+([\w.]+)\s+import\b/g)].map(match => match[1]);
      for (const match of code.matchAll(/(?:^|[;\n])\s*import\s+([^;\n]+)/g)) imports.push(...match[1].split(',').map(item => item.trim().split(/\s+/)[0]));
      if (imports.some(module => deniedModules.test(module)) || /\b(__import__|eval|exec|compile|open)\s*\(/.test(code)) fail('static_scan', `Phát hiện import hoặc hàm bị cấm trong ${name}.`);
    } else {
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      const includes = [...code.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)].map(match => match[1]);
      if (includes.some(include => /^(\/|\.\.|sys\/|linux\/|windows|winsock|unistd|process|pthread|thread|future|filesystem|fstream|dlfcn)/i.test(include)) || /\b(system|fork|vfork|clone|socket|connect|bind|listen|accept|popen|fopen|freopen|open|ptrace|mmap|exec\w*|__asm__|asm)\s*\(/.test(code)) fail('static_scan', `Phát hiện include hoặc hàm bị cấm trong ${name}.`);
    }
  }
  if (extraScanner) await extraScanner(source);
}
module.exports = { UPLOAD_LIMIT, FILE_LIMIT, safeName, extractSource, scanSource };
