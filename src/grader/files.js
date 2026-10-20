const fs = require('node:fs/promises');
const path = require('node:path');

const TREE_LIMIT = 20 * 1024 * 1024, FILE_COUNT = 200;
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

// Artifacts travel as JSON {path, data(base64), mode}; same limits on both ends.
async function readTree(root) {
  const files = []; let total = 0;
  async function walk(current, relative) {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name, full = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(full, name); continue; }
      if (!entry.isFile()) throw new Error(`Artifact chứa mục không phải file: ${name}`);
      const data = await fs.readFile(full); total += data.length;
      if (files.length >= FILE_COUNT || total > TREE_LIMIT) throw new Error('Artifact vượt giới hạn.');
      files.push({ path: name, data: data.toString('base64'), executable: ((await fs.stat(full)).mode & 0o111) !== 0 || name === 'bot' });
    }
  }
  await walk(root, '');
  return { files };
}
async function writeTree(root, tree) {
  if (!tree || !Array.isArray(tree.files) || !tree.files.length || tree.files.length > FILE_COUNT) throw new Error('Artifact không hợp lệ.');
  await fs.mkdir(root, { recursive: true, mode: 0o755 }); await fs.chmod(root, 0o755);
  let total = 0;
  for (const file of tree.files) {
    const parts = typeof file?.path === 'string' ? file.path.split('/') : [];
    if (!parts.length || parts.length > 8 || parts.some(part => !NAME.test(part) || part.endsWith('.')) || typeof file.data !== 'string') throw new Error('Đường dẫn artifact không hợp lệ.');
    const data = Buffer.from(file.data, 'base64'); total += data.length;
    if (total > TREE_LIMIT) throw new Error('Artifact vượt giới hạn.');
    const destination = path.join(root, ...parts);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
    await fs.writeFile(destination, data, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 });
  }
}
module.exports = { readTree, writeTree };
