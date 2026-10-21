const { spawn } = require('node:child_process');

// Cloudflare Pages direct upload through wrangler fetched by npx at a pinned version (no project dependency).
function deployConfig(env = process.env) {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_PAGES_PROJECT) return null;
  return { token: env.CLOUDFLARE_API_TOKEN, account: env.CLOUDFLARE_ACCOUNT_ID, project: env.CLOUDFLARE_PAGES_PROJECT, wrangler: env.WRANGLER_VERSION || '3.80.0' };
}
function deploySite(dir, config) {
  const args = ['--yes', `wrangler@${config.wrangler}`, 'pages', 'deploy', dir, '--project-name', config.project, '--branch', 'main', '--commit-dirty=true'];
  const windows = process.platform === 'win32';
  return new Promise(resolve => {
    // npx is a .cmd on Windows and needs a shell there; arguments are quoted because the site path may contain spaces.
    const child = spawn('npx', windows ? args.map(arg => `"${arg}"`) : args, { shell: windows, windowsHide: true,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: config.token, CLOUDFLARE_ACCOUNT_ID: config.account } });
    let output = '';
    const timer = setTimeout(() => child.kill(), 600000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-20000); }); child.stderr.on('data', chunk => { output = (output + chunk).slice(-20000); });
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, output: error.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, output: output || `exit ${code}` }); });
  });
}
module.exports = { deployConfig, deploySite };
