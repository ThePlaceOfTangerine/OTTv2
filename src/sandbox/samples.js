const path = require('node:path');
const SAMPLES = Object.freeze({
  'python-greedy': { language: 'python', entry: 'main.py' },
  'cpp-greedy': { language: 'cpp', entry: 'main.cpp' }
});
function sampleSource(id) {
  if (!Object.hasOwn(SAMPLES, id)) throw new Error('Unknown sample bot');
  return { id, ...SAMPLES[id], directory: path.resolve(__dirname, '../../bots', id) };
}
module.exports = { SAMPLES, sampleSource };
