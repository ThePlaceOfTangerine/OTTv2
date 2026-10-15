const { spawn } = require('node:child_process');
const path = require('node:path');
const { SandboxManager, dockerBinary, dockerEnv } = require('../src/sandbox/docker');
async function main() {
  if (process.argv[2] === 'build') {
    const child = spawn(dockerBinary(), ['build', '-t', process.env.SANDBOX_IMAGE || 'ottv2-sandbox:phase3', path.resolve(__dirname, '../sandbox')], { env: dockerEnv(), stdio: 'inherit', windowsHide: true });
    await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Build exited ${code}`))); });
  } else console.log(JSON.stringify(await new SandboxManager().check(), null, 2));
}
main().catch(error => { console.error(`${error.code || error.name}: ${error.message}`); process.exitCode = 1; });
