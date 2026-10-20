// QEMU boot test of the USB images (inside the ott-build WSL distro, as root):
//   node usb/boot-test.js grader [--bios] [--img FILE]     USB grader enrolls with a real coordinator here and grades a real submission
//   node usb/boot-test.js thisinh [--img FILE]             contestant USB: firewall, browser policy, desktop, ott-run, persistence over 2 boots
// The VM sees this machine as 10.0.2.2 (QEMU user network). The image is copied first, so the built .img stays pristine.
// A blank disk labelled INTERNAL plays the computer's own hard disk: it must never be mounted and its bytes must not change.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawn, execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const { openDatabase } = require(`${repo}/src/db`);
const { createApp } = require(`${repo}/src/app`);
const { createUser } = require(`${repo}/src/users`);
const { renderGrader, renderPortal } = require(`${repo}/src/usb/config`);

const [kind, ...rest] = process.argv.slice(2);
const bios = rest.includes('--bios'), imgArg = rest.includes('--img') ? rest[rest.indexOf('--img') + 1] : null;
const work = `/var/tmp/ott-boot-${kind}${bios ? '-bios' : ''}`, shots = '/mnt/e/OTTv2/output/playwright';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

function partitionOffset(img, number) {
  const table = JSON.parse(execFileSync('sfdisk', ['-J', img], { encoding: 'utf8' })).partitiontable;
  return table.partitions[number - 1].start * 512;
}
function writeConf(img, files) {
  const offset = partitionOffset(img, 3);
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(work, name); fs.writeFileSync(file, text);
    execFileSync('mcopy', ['-o', '-i', `${img}@@${offset}`, file, `::/${name}`]);
  }
}
function boot(img, internal, { rtc } = {}) {
  const serial = path.join(work, `serial-${Date.now()}.log`), monitor = path.join(work, 'monitor.sock');
  fs.rmSync(monitor, { force: true });
  const args = ['-machine', 'q35', '-m', '3072', '-smp', '2', ...(fs.existsSync('/dev/kvm') ? ['-enable-kvm', '-cpu', 'host'] : []),
    '-device', 'qemu-xhci', '-drive', `if=none,id=stick,format=raw,file=${img}`, '-device', `usb-storage,drive=stick${rest.includes('--debug') ? '' : ',bootindex=0'}`,
    '-drive', `if=none,id=hdd,format=raw,file=${internal}`, '-device', 'virtio-blk-pci,drive=hdd',
    '-nic', 'user,model=virtio-net-pci', '-serial', `file:${serial}`, '-display', 'none', '-vga', 'std', '-monitor', `unix:${monitor},server,nowait`,
    ...(rtc ? ['-rtc', `base=${rtc}`] : [])];
  // --debug: boot the image's kernel directly with the serial console last and the journal forwarded to it (skips the bootloader).
  if (rest.includes('--debug')) {
    const live = `/var/tmp/ott-usb/${kind}/iso/live`;
    args.push('-kernel', `${live}/vmlinuz`, '-initrd', `${live}/initrd.img`, '-append',
      `boot=live ${kind === 'grader' ? 'toram noswap' : 'noswap persistence persistence-storage=filesystem persistence-label=persistence'} console=tty0 console=ttyS0,115200 systemd.journald.forward_to_console=1`);
  }
  if (!bios) {
    const vars = path.join(work, 'OVMF_VARS.fd'); fs.copyFileSync('/usr/share/OVMF/OVMF_VARS_4M.ms.fd', vars);
    // Microsoft keys enrolled, Secure Boot on: the shim/GRUB/kernel chain must be signed to boot at all.
    args.push('-drive', 'if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.ms.fd', '-drive', `if=pflash,format=raw,file=${vars}`);
  }
  const qemu = spawn('qemu-system-x86_64', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const read = () => (fs.existsSync(serial) ? fs.readFileSync(serial, 'utf8') : '');
  const command = text => new Promise((resolve, reject) => {
    const socket = net.connect(monitor, () => { socket.write(`${text}\n`); setTimeout(() => { socket.end(); resolve(); }, 1500); });
    socket.on('error', reject);
  });
  const results = () => ({ ...Object.fromEntries([...read().matchAll(/OTT-SELFTEST (\w+)=([^\r\n]*)/g)].map(m => [m[1], m[2].trim()])), ...(/OTT-SELFTEST done/.test(read()) ? { done: true } : {}) });
  return {
    qemu, read, results, command,
    async until(predicate, label, ms) {
      const end = Date.now() + ms;
      while (!(await predicate())) {
        if (qemu.exitCode !== null) throw new Error(`QEMU đã thoát khi chờ ${label}.\n${read().slice(-3000)}`);
        if (Date.now() > end) throw new Error(`Hết giờ chờ ${label}.\n--- serial (cuối) ---\n${read().slice(-3000)}`);
        await sleep(2000);
      }
    },
    async stop() { await command('quit').catch(() => qemu.kill()); await new Promise(resolve => qemu.exitCode !== null ? resolve() : qemu.once('exit', resolve)); }
  };
}

async function main() {
  if (!['grader', 'thisinh'].includes(kind)) throw new Error('Cách dùng: node usb/boot-test.js grader|thisinh [--bios] [--img FILE]');
  fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const img = path.join(work, 'usb.img'), internal = path.join(work, 'internal.img');
  fs.copyFileSync(imgArg || `/mnt/e/OTTv2-local/usb/ott-${kind}.img`, img);
  execFileSync('truncate', ['-s', '64M', internal]); execFileSync('mkfs.ext4', ['-q', '-L', 'INTERNAL', internal]);
  const internalHash = sha(internal);

  const db = openDatabase(path.join(work, 'coordinator.sqlite'));
  await createUser(db, { username: 'boss', password: 'boss-password-2026', role: 'admin' });
  await createUser(db, { username: 'doi-01', password: 'doi-password-2026', mustChangePassword: false });
  const app = await createApp({ db, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(work, 'subs') }, publicationOptions: { siteDir: path.join(work, 'site'), log: () => {} } });
  app.locals.submissions.start({ local: false });  // only the USB grader may check submissions
  // Pages the USB's Firefox really fetched: a page blocked by the browser policy never reaches the server.
  const browserHits = new Set();
  const server = http.createServer((req, res) => { if (/Firefox/.test(req.headers['user-agent'] || '')) browserHits.add(req.url.split('?')[0]); app(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, url = `http://10.0.2.2:${port}`, report = { kind, firmware: bios ? 'BIOS' : 'UEFI Secure Boot' };
  const other = http.createServer((req, res) => res.end('should be blocked')); await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  let vm;
  try {
    if (rest.includes('--grub-lock')) {
      // Red team: pressing "e" in the GRUB menu (to add init=/bin/sh) must ask for the organizers' password instead of opening the editor.
      writeConf(img, kind === 'grader' ? { 'grader.env': renderGrader({ url, code: 'ott-' + 'x'.repeat(30), slots: 1 }) } : { 'portal.env': renderPortal({ portal: url }) });
      vm = boot(img, internal);
      await vm.until(() => /executed automatically/.test(vm.read()), 'menu GRUB', 60000);
      await vm.command('sendkey e'); await sleep(3000);
      const screen = vm.read().slice(-4000);
      report.grubLock = { askedPassword: /Enter username/.test(screen), editorOpened: /Emacs-like|boot=live .*init=|Press Ctrl-x/.test(screen) };
      await vm.stop(); vm = null;
      assert.equal(report.grubLock.askedPassword, true, 'GRUB phải hỏi mật khẩu'); assert.equal(report.grubLock.editorOpened, false, 'không được mở trình sửa');
      console.log(JSON.stringify(report, null, 2)); console.log('BOOT TEST OK'); return;
    }
    if (kind === 'grader') {
      const { code } = app.locals.graders.openEnrollment(1, { namePrefix: 'qemu', maxUses: 3, minutes: 60 });
      writeConf(img, { 'grader.env': renderGrader({ url, code, slots: 1 }), SELFTEST: 'grader\r\n' });
      const started = performance.now();
      // Hardware clock six years behind, as on a PC whose RTC is wrong: the USB must take the coordinator's time before signing.
      vm = boot(img, internal, { rtc: '2020-01-01T00:00:00' });
      const online = () => app.locals.graders.list().find(g => g.lastSeenAt && Date.now() - g.lastSeenAt < 15000);
      await vm.until(online, 'máy chấm USB đăng ký và kết nối', 300000);
      report.enrolledAfterSeconds = Math.round((performance.now() - started) / 1000); report.grader = online().name; report.image = online().image;
      log(`Máy chấm ${report.grader} kết nối sau ${report.enrolledAfterSeconds} s, image ${report.image}`);
      const bot = fs.readFileSync(`${repo}/bots/templates/python/main.py`);
      const submission = await app.locals.submissions.submit({ userId: 2, filename: 'main.py', buffer: bot });
      const detail = () => app.locals.submissions.detail(submission.id, 2);
      await vm.until(() => ['Accepted', 'Rejected'].includes(detail().status), 'bài nộp được máy chấm USB chấm xong', 360000);
      report.submission = `${detail().status}${detail().reason ? ` (${detail().reason})` : ''}`;
      await vm.until(() => vm.results().done !== undefined, 'tự kiểm tra', 120000);
      Object.assign(report, { selftest: vm.results() });
      assert.equal(detail().status, 'Accepted', report.submission);
      assert.equal(report.selftest.enrolled, 'yes'); assert.equal(report.selftest.grader, 'active'); assert.equal(report.selftest.toram, 'yes');
      assert.ok(Number(report.selftest.clock.slice(0, 4)) >= 2026, `giờ chưa được chỉnh: ${report.selftest.clock}`);
      assert.equal(report.image, report.selftest.image);
    } else {
      writeConf(img, { 'portal.env': renderPortal({ portal: url }), SELFTEST: `OTHER_PORT=${other.address().port}\r\n` });
      for (const round of [1, 2]) {
        vm = boot(img, internal);
        await vm.until(() => vm.results().done !== undefined, `tự kiểm tra lần ${round}`, 420000);
        if (round === 1) { await vm.until(() => browserHits.has('/portal') && browserHits.has('/assets/app.js'), 'Firefox trên USB mở được portal', 60000); report.browserFetched = [...browserHits].sort(); }
        const result = vm.results(); report[`boot${round}`] = result;
        if (round === 1) { fs.mkdirSync(shots, { recursive: true }); await vm.command(`screendump ${shots}/usb-thisinh-desktop.png -f png`); }
        await vm.stop(); vm = null;
        assert.equal(result.portal, '200'); assert.equal(result.internet, '000'); assert.equal(result.other_port, '000');
        assert.equal(result.firewall_policy, 'policy_drop'); assert.equal(result.homepage, `${url}/portal`);
        assert.equal(result.desktop, 'up'); assert.equal(result.browser, 'up'); assert.equal(result.sudo, 'absent'); assert.equal(result.root_password, 'L');
        assert.equal(result.persist_mount, 'yes'); assert.equal(result.dirty_expire, '200'); assert.match(result.ott_run, /^0 replay=yes$/);
        assert.match(result.persistence, round === 1 ? /^created$/ : /^found:\d+$/);
      }
    }
    const mounted = kind === 'grader' ? report.selftest.mounted : `${report.boot1.mounted} ${report.boot2.mounted}`;
    assert.ok(!/INTERNAL/.test(mounted), `ổ của máy bị mount: ${mounted}`);
    if (!bios) assert.equal((kind === 'grader' ? report.selftest : report.boot1).secureboot, '1', 'Secure Boot phải đang bật');
  } finally {
    if (vm) await vm.stop();
    server.closeAllConnections(); server.close(); other.close(); await app.locals.submissions.close(); await app.locals.publications.close(); db.close();
  }
  report.internalDiskUnchanged = sha(internal) === internalHash;
  assert.ok(report.internalDiskUnchanged, 'ổ của máy đã bị ghi');
  console.log(JSON.stringify(report, null, 2));
  console.log('BOOT TEST OK');
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
