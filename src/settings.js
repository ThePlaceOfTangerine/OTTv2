const fs = require('node:fs');
const path = require('node:path');

// data/settings.json is written by the first-run wizard (/setup). Real environment variables always win over it.
const KEYS = ['SANDBOX_BACKEND', 'HOST', 'PORT'];
const settingsPath = () => path.resolve(process.env.OTT_SETTINGS || path.join(path.dirname(path.resolve(process.env.DB_PATH || path.join(__dirname, '../data/arena.sqlite'))), 'settings.json'));

function readSettings(file = settingsPath()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`Không đọc được ${file}: ${error.message}`); }
}
function loadSettings(file = settingsPath(), env = process.env) {
  const settings = readSettings(file);
  for (const key of KEYS) if (env[key] === undefined && settings.env?.[key] !== undefined) env[key] = String(settings.env[key]);
  return settings;
}
function saveSettings(values, file = settingsPath()) {
  const settings = readSettings(file);
  settings.env = { ...settings.env, ...Object.fromEntries(Object.entries(values).filter(([key]) => KEYS.includes(key))) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return settings;
}
// classroom = windows-job (no network/file isolation): results are practice only, never an official tournament.
const trustLevel = (env = process.env) => (env.SANDBOX_BACKEND === 'windows-job' ? 'classroom' : 'official');
module.exports = { loadSettings, saveSettings, readSettings, settingsPath, trustLevel };
