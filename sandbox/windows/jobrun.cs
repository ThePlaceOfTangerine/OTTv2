// EXPERIMENTAL classroom sandbox helper (Windows). Compiled on first use with the .NET Framework csc.exe.
// Usage: jobrun <cpuMs> <wallMs> <memoryMb> <outputBytes> [--processes=N] <exe> [args...]
// Reads stdin to EOF, starts exe SUSPENDED inside a Job Object (memory limit, CPU time, one process, kill on close),
// (--processes raises the process limit, only for compilers: g++ starts cc1plus/as/ld), resumes it, and prints one JSON line: stdout, stderr, cpu_ms, wall_ms, exit_code, fault.
// It does NOT block network or file access; use Docker/WSL2 for real tournaments.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

static class JobRun {
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong R, W, O, RB, WB, OB; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting { public long TotalUserTime, TotalKernelTime, PeriodUserTime, PeriodKernelTime; public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
    public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInformation { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, int length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting info, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
    bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation info);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes attributes, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, int mask, int flags);
  [DllImport("kernel32.dll")] static extern uint SetErrorMode(uint mode);

  const uint LIMIT_PROCESS_TIME = 0x2, LIMIT_ACTIVE_PROCESS = 0x8, LIMIT_PROCESS_MEMORY = 0x100, LIMIT_DIE_ON_EXCEPTION = 0x400, LIMIT_KILL_ON_CLOSE = 0x2000;
  const uint CREATE_SUSPENDED = 0x4, CREATE_NO_WINDOW = 0x08000000, CREATE_BREAKAWAY_FROM_JOB = 0x01000000;

  static void Pipe(out IntPtr childEnd, out IntPtr parentEnd, bool childReads) {
    var sa = new SecurityAttributes(); sa.nLength = Marshal.SizeOf(sa); sa.bInheritHandle = 1;
    IntPtr read, write;
    if (!CreatePipe(out read, out write, ref sa, 0)) throw new Exception("CreatePipe failed");
    childEnd = childReads ? read : write; parentEnd = childReads ? write : read;
    SetHandleInformation(parentEnd, 1, 0);
  }
  static string Quote(string arg) {
    if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
    var sb = new StringBuilder("\""); int slashes = 0;
    foreach (char c in arg) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') sb.Append('\\', slashes * 2 + 1); else sb.Append('\\', slashes);
      slashes = 0; sb.Append(c);
    }
    sb.Append('\\', slashes * 2); sb.Append('"'); return sb.ToString();
  }
  static string Json(string value) {
    var sb = new StringBuilder("\"");
    foreach (char c in value) {
      if (c == '"' || c == '\\') { sb.Append('\\'); sb.Append(c); }
      else if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
      else sb.Append(c);
    }
    return sb.Append('"').ToString();
  }
  sealed class Capture {
    public readonly MemoryStream Data = new MemoryStream(); public bool Overflow; public Thread Thread;
    public Capture(IntPtr handle, int limit) {
      var stream = new FileStream(new SafeFileHandle(handle, true), FileAccess.Read);
      Thread = new Thread(() => {
        var buffer = new byte[8192]; int read;
        try { while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) { if (Data.Length + read > limit) Overflow = true; else Data.Write(buffer, 0, read); } }
        catch (IOException) { }
        finally { stream.Dispose(); }
      });
      Thread.IsBackground = true; Thread.Start();
    }
  }

  static int Main(string[] args) {
    SetErrorMode(0x0001 | 0x0002 | 0x8000);
    long cpuMs = long.Parse(args[0]), wallMs = long.Parse(args[1]), memoryMb = long.Parse(args[2]); int outputBytes = int.Parse(args[3]);
    int first = 4; uint processes = 1;
    if (args[4].StartsWith("--processes=")) { processes = uint.Parse(args[4].Substring(12)); first = 5; }
    byte[] input; using (var stdin = Console.OpenStandardInput()) using (var buffer = new MemoryStream()) { stdin.CopyTo(buffer); input = buffer.ToArray(); }

    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    var limit = new ExtendedLimit();
    limit.Basic.LimitFlags = LIMIT_PROCESS_TIME | LIMIT_ACTIVE_PROCESS | LIMIT_PROCESS_MEMORY | LIMIT_DIE_ON_EXCEPTION | LIMIT_KILL_ON_CLOSE;
    limit.Basic.PerProcessUserTimeLimit = (cpuMs + 100) * 10000;  // 100 ns units; the exact limit is checked from accounting below.
    limit.Basic.ActiveProcessLimit = processes;                    // 1 = no child processes: blocks fork bombs and subprocess spawning.
    limit.ProcessMemoryLimit = new UIntPtr((ulong)memoryMb * 1024 * 1024);
    if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limit, Marshal.SizeOf(limit))) throw new Exception("Job Object setup failed");

    IntPtr childIn, parentIn, childOut, parentOut, childErr, parentErr;
    Pipe(out childIn, out parentIn, true); Pipe(out childOut, out parentOut, false); Pipe(out childErr, out parentErr, false);
    var startup = new StartupInfo(); startup.cb = Marshal.SizeOf(startup); startup.dwFlags = 0x100; startup.hStdInput = childIn; startup.hStdOutput = childOut; startup.hStdError = childErr;
    var command = new StringBuilder();
    for (int i = first; i < args.Length; i++) { if (i > first) command.Append(' '); command.Append(Quote(args[i])); }
    ProcessInformation info;
    // Breakaway lets the job be assigned even if this helper already runs inside another job (e.g. a terminal or Node's job).
    if (!CreateProcessW(null, command, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB, IntPtr.Zero, null, ref startup, out info)
      && !CreateProcessW(null, command, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, null, ref startup, out info))
      throw new Exception("CreateProcess failed: " + Marshal.GetLastWin32Error());
    CloseHandle(childIn); CloseHandle(childOut); CloseHandle(childErr);
    if (!AssignProcessToJobObject(job, info.hProcess)) { TerminateJobObject(job, 1); throw new Exception("AssignProcessToJobObject failed: " + Marshal.GetLastWin32Error()); }
    var stopwatch = Stopwatch.StartNew();
    ResumeThread(info.hThread);
    var stdout = new Capture(parentOut, outputBytes); var stderr = new Capture(parentErr, outputBytes);
    using (var stdin = new FileStream(new SafeFileHandle(parentIn, true), FileAccess.Write)) { try { stdin.Write(input, 0, input.Length); } catch (IOException) { } }
    // The Job's own per-process time limit is enforced only coarsely (measured: 0.3 s limit killed at 1.5 s), so poll accounting like supervisor.py does.
    bool timedOut = false; Accounting accounting; double cpu;
    while (true) {
      bool exited = WaitForSingleObject(info.hProcess, 10) == 0;
      QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero);
      cpu = (accounting.TotalUserTime + accounting.TotalKernelTime) / 10000.0;
      if (exited) break;
      if (cpu > cpuMs || stopwatch.ElapsedMilliseconds > wallMs) { timedOut = cpu <= cpuMs; TerminateJobObject(job, 1); WaitForSingleObject(info.hProcess, 5000); break; }
    }
    stdout.Thread.Join(5000); stderr.Thread.Join(5000);
    uint exitCode; GetExitCodeProcess(info.hProcess, out exitCode);
    QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero);
    cpu = (accounting.TotalUserTime + accounting.TotalKernelTime) / 10000.0;
    string fault = cpu > cpuMs ? "cpu_timeout" : timedOut ? "wall_timeout" : stdout.Overflow || stderr.Overflow ? "output_limit" : exitCode != 0 ? "bot_crash" : null;
    Console.Out.Write("{\"stdout\":" + Json(Encoding.UTF8.GetString(stdout.Data.ToArray())) + ",\"stderr\":" + Json(Encoding.UTF8.GetString(stderr.Data.ToArray())) +
      ",\"cpu_ms\":" + cpu.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + ",\"wall_ms\":" + stopwatch.ElapsedMilliseconds +
      ",\"exit_code\":" + (int)exitCode + ",\"fault\":" + (fault == null ? "null" : Json(fault)) + "}\n");
    CloseHandle(info.hThread); CloseHandle(info.hProcess); CloseHandle(job);
    return 0;
  }
}
