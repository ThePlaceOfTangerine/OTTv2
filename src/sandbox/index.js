const { SandboxManager } = require('./docker');

// SANDBOX_BACKEND: docker (default), bwrap (Linux/WSL2 grader rootfs) or windows-job (EXPERIMENTAL classroom mode).
function createSandboxManager(backend = process.env.SANDBOX_BACKEND || 'docker') {
  if (backend === 'docker') return new SandboxManager();
  if (backend === 'bwrap') return new (require('./bwrap').BwrapManager)();
  if (backend === 'windows-job') return new (require('./windows-job').WindowsJobManager)();
  throw new Error(`SANDBOX_BACKEND không hợp lệ: ${backend} (docker, bwrap hoặc windows-job).`);
}
module.exports = { createSandboxManager };
