"""Trusted RPC supervisor. Bot stdout is NEVER forwarded to the RPC channel.

Each move runs a fresh child, inheriting only its three pipes. Landlock restricts
file reads as well as writes; seccomp kills network, fork and signal attacks.
Unsupported kernel/policy is an infrastructure failure, never a bot forfeit.
"""
import base64
import ctypes
import json
import math
import os
import pathlib
import platform
import resource
import shutil
import selectors
import signal
import subprocess
import sys
import time

libc = ctypes.CDLL(None, use_errno=True)
sec = ctypes.CDLL('libseccomp.so.2', use_errno=True)
libc.syscall.restype = ctypes.c_long
sec.seccomp_init.argtypes = [ctypes.c_uint32]
sec.seccomp_init.restype = ctypes.c_void_p
sec.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
sec.seccomp_syscall_resolve_name.restype = ctypes.c_int
sec.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
sec.seccomp_load.argtypes = [ctypes.c_void_p]
sec.seccomp_release.argtypes = [ctypes.c_void_p]

class RuleAttr(ctypes.Structure):
    _fields_ = [('handled_access_fs', ctypes.c_uint64)]

class PathAttr(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('allowed_access', ctypes.c_uint64), ('parent_fd', ctypes.c_int)]

READ = (1 << 2) | (1 << 3)
EXEC = 1 << 0
ALL_FS = (1 << 15) - 1  # FS rights through TRUNCATE; require ABI >= 3.

def check(value, what):
    if value < 0:
        raise OSError(ctypes.get_errno(), what)
    return value

def landlock(paths):
    if platform.machine() not in ('x86_64', 'aarch64'):
        raise RuntimeError('Unsupported Landlock architecture')
    # Linux asm-generic syscall numbers, shared by x86_64 and aarch64.
    abi = check(libc.syscall(444, 0, 0, 1), 'Landlock ABI unavailable')
    if abi < 3:
        raise RuntimeError('Landlock ABI >= 3 required')
    attr = RuleAttr(ALL_FS)
    fd = check(libc.syscall(444, ctypes.byref(attr), ctypes.sizeof(attr), 0), 'Landlock create')
    try:
        for path, rights in paths:
            if not os.path.exists(path):
                continue
            parent = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                if not os.path.isdir(path):
                    rights &= ~(1 << 3)  # READ_DIR is valid only for directories.
                rule = PathAttr(rights, parent)
                check(libc.syscall(445, fd, 1, ctypes.byref(rule), 0), 'Landlock add path')
            finally:
                os.close(parent)
        check(libc.prctl(38, 1, 0, 0, 0), 'no_new_privs')
        check(libc.syscall(446, fd, 0), 'Landlock restrict')
    finally:
        os.close(fd)
    return abi

def seccomp(compiler=False):
    ctx = sec.seccomp_init(0x7fff0000)  # ALLOW; Docker also enforces its default allowlist.
    if not ctx:
        raise RuntimeError('seccomp init failed')
    denied = ['socket', 'socketpair', 'connect', 'bind', 'listen', 'accept', 'accept4',
              'ptrace', 'process_vm_readv', 'process_vm_writev', 'pidfd_open', 'pidfd_getfd',
              'kill', 'tkill', 'tgkill', 'rt_sigqueueinfo', 'rt_tgsigqueueinfo',
              'bpf', 'mount', 'umount2', 'unshare', 'setns', 'io_uring_setup',
              'open_by_handle_at', 'name_to_handle_at', 'userfaultfd', 'keyctl',
              'add_key', 'request_key', 'reboot', 'kexec_load', 'perf_event_open']
    if not compiler:
        denied += ['clone', 'clone3', 'fork', 'vfork']
    try:
        for name in denied:
            number = sec.seccomp_syscall_resolve_name(name.encode())
            if number >= 0 and sec.seccomp_rule_add(ctx, 0x80000000, number, 0) < 0:
                raise RuntimeError('seccomp rule failed: ' + name)
        if sec.seccomp_load(ctx) < 0:
            raise RuntimeError('seccomp load failed')
    finally:
        sec.seccomp_release(ctx)

def confine(language, compiler, memory_mb, cpu_ms):
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (max(1, math.ceil(cpu_ms / 1000)), max(2, math.ceil(cpu_ms / 1000) + 1)))
    paths = [('/usr/lib', READ | EXEC), ('/lib', READ | EXEC), ('/lib64', READ | EXEC),
             ('/dev/null', (1 << 1) | (1 << 2)), ('/tmp', ALL_FS & ~EXEC)]
    if compiler:
        paths += [('/usr', READ | EXEC), ('/source', READ), ('/work', ALL_FS)]
    else:
        paths += [('/bot', READ), ('/work', ALL_FS & ~EXEC)]
        paths += [('/usr/bin/python3', READ | EXEC)] if language == 'python' else [('/work/bot', READ | EXEC)]
    landlock(paths)
    seccomp(compiler)

def cpu_of(pid):
    try:
        with open('/proc/%d/stat' % pid) as f:
            fields = f.read().rsplit(')', 1)[1].split()
        return (int(fields[11]) + int(fields[12])) * 1000 / os.sysconf('SC_CLK_TCK')
    except (FileNotFoundError, ProcessLookupError):
        return 0

def execute(command, data, language, compiler=False, cpu_ms=500, wall_ms=3000, memory_mb=256, output_bytes=65536):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    started = time.monotonic()
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True, close_fds=True, cwd='/work',
        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'HOME': '/work', 'TMPDIR': '/tmp'},
        preexec_fn=lambda: confine(language, compiler, memory_mb, cpu_ms))
    selector = selectors.DefaultSelector()
    outputs = {'stdout': bytearray(), 'stderr': bytearray()}
    pending = memoryview(data)
    if pending:
        os.set_blocking(process.stdin.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
    else:
        process.stdin.close()
    for name in outputs:
        stream = getattr(process, name)
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, name)
    fault = None
    try:
        while selector.get_map():
            elapsed = (time.monotonic() - started) * 1000
            if elapsed > wall_ms:
                fault = 'wall_timeout'; break
            if cpu_of(process.pid) > cpu_ms:
                fault = 'cpu_timeout'; break
            for key, _ in selector.select(0.01):
                if key.data == 'stdin':
                    try:
                        pending = pending[os.write(key.fd, pending):]
                    except BrokenPipeError:
                        pending = memoryview(b'')
                    if not pending:
                        selector.unregister(key.fileobj); key.fileobj.close()
                else:
                    block = os.read(key.fd, 8192)
                    if not block:
                        selector.unregister(key.fileobj); key.fileobj.close()
                    else:
                        remaining = output_bytes - sum(len(v) for v in outputs.values())
                        outputs[key.data].extend(block[:remaining])
                        if len(block) > remaining:
                            fault = 'output_limit'; break
            if fault:
                break
        if fault:
            os.killpg(process.pid, signal.SIGKILL)
        try:
            process.wait(timeout=max(0.01, (wall_ms - (time.monotonic() - started) * 1000) / 1000))
        except subprocess.TimeoutExpired:
            fault = 'wall_timeout'; os.killpg(process.pid, signal.SIGKILL); process.wait()
    finally:
        selector.close()
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL); process.wait()
        for stream in [process.stdin, process.stdout, process.stderr]:
            if not stream.closed:
                stream.close()
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    measured = ((after.ru_utime + after.ru_stime) - (before.ru_utime + before.ru_stime)) * 1000
    if measured > cpu_ms:
        fault = 'cpu_timeout'
    if not fault and process.returncode:
        fault = 'sandbox_violation' if process.returncode == -signal.SIGSYS else 'bot_crash'
    return {'stdout': bytes(outputs['stdout'][:output_bytes]).decode('utf-8', 'replace'),
            'stderr': bytes(outputs['stderr'][:output_bytes]).decode('utf-8', 'replace'),
            'cpu_ms': round(measured, 3), 'wall_ms': round((time.monotonic() - started) * 1000, 3),
            'exit_code': process.returncode, 'fault': fault}

def probe():
    # Run on the supervisor only in this short-lived probe container. Production
    # confines child processes, keeping the trusted parent outside their policy.
    abi = landlock([('/usr', READ | EXEC), ('/lib', READ | EXEC), ('/lib64', READ | EXEC)])
    seccomp()
    try:
        with open('/etc/passwd'):
            pass
    except PermissionError:
        return {'landlock_abi': abi, 'seccomp': True, 'passwd_denied': True}
    raise RuntimeError('File isolation probe failed')

def emit(value):
    print(json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)

def main():
    if sys.argv[1:] == ['probe']:
        emit({'kind': 'probe', **probe()}); return
    mode, language, entry = sys.argv[1:]
    # This checks kernel support before starting untrusted code; preexec failures
    # are also reported as infrastructure errors by the outer handler.
    abi = check(libc.syscall(444, 0, 0, 1), 'Landlock unavailable')
    if abi < 3:
        raise RuntimeError('Landlock ABI >= 3 required')
    if mode == 'run' and language == 'cpp':
        # Windows bind mounts need not preserve executable permission. Execute
        # from the bounded container tmpfs, never from or on the host filesystem.
        shutil.copyfile('/bot/bot', '/work/bot')
        os.chmod('/work/bot', 0o555)
    emit({'kind': 'ready', 'landlock_abi': abi})
    for line in sys.stdin.buffer:
        if len(line) > 1024 * 1024:
            raise RuntimeError('RPC input too large')
        request = json.loads(line)
        ident = request['id']
        if mode == 'compile':
            if language == 'cpp':
                units = sorted(str(p) for p in pathlib.Path('/source').rglob('*.cpp'))
                command = ['/usr/bin/g++', '-O2', '-std=c++17', *units, '-o', '/work/bot']
            else:
                command = ['/usr/bin/python3', '-I', '-B', '-c',
                           'import pathlib,sys; [compile(p.read_bytes(),str(p),"exec") for p in pathlib.Path("/source").rglob("*.py")]']
            result = execute(command, b'', language, compiler=True, cpu_ms=20000, wall_ms=45000, memory_mb=768)
            if not result['fault'] and language == 'cpp':
                with open('/work/bot', 'rb') as f:
                    binary = f.read(8 * 1024 * 1024 + 1)
                if len(binary) > 8 * 1024 * 1024:
                    result['fault'] = 'artifact_limit'
                else:
                    result['binary'] = base64.b64encode(binary).decode('ascii')
        elif mode == 'run':
            limits = request['request']['limits']
            command = ['/usr/bin/python3', '-I', '-S', '-B', '-c',
                       'import runpy,sys,os; sys.path[:0]=[os.path.dirname(sys.argv[1]),"/bot"]; runpy.run_path(sys.argv[1],run_name="__main__")',
                       '/bot/' + entry] if language == 'python' else ['/work/bot']
            result = execute(command, (json.dumps(request['request']) + '\n').encode(), language,
                cpu_ms=limits['moveCpuMs'], wall_ms=limits['moveWallMs'], memory_mb=limits['memoryMb'], output_bytes=limits['outputBytes'])
        else:
            raise RuntimeError('Unknown mode')
        emit({'kind': 'result', 'id': ident, **result})

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'kind': 'infrastructure_error', 'error': type(error).__name__ + ': ' + str(error)})
        sys.exit(70)
