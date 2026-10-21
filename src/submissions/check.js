const { sampleSource } = require('../sandbox/samples');
const { runMatch, verifyReplay } = require('../game/match');
const { BotFault, InfrastructureError, LIMITS } = require('../game/protocol');
const { extractSource, extractRepo, scanSource } = require('./source');

// Scan, compile and two test games against the sample bot. All state goes through the hooks, so a remote grader runs the same steps.
async function runCheck(job, { manager, directory, source, progress, meta, live, test, keep }, { extraScanner } = {}) {
  const artifacts = [], sessions = [];
  let failure;
  try {
    await progress('Scanning', job.commit ? `Đang tải commit ${job.commit.slice(0, 7)} từ GitHub, giải nén và kiểm tra mã nguồn.` : 'Đang giải nén, kiểm tra mã nguồn và các thao tác bị cấm.');
    const buffer = await source();
    const parsed = job.commit ? await extractRepo({ buffer, directory }) : await extractSource({ buffer, filename: job.filename, entry: job.entry, directory });
    await meta({ language: parsed.language, entry: parsed.entry });
    await scanSource(parsed, extraScanner);
    await progress('Compiling', `Đang kiểm tra cú pháp hoặc biên dịch ${parsed.language === 'cpp' ? 'C++17' : 'Python'} trong Docker.`);
    if (job.image) manager.imageId = job.image;
    await manager.check();
    if (manager.imageId) await meta({ image: manager.imageId });
    const candidate = await manager.prepare({ ...parsed, id: job.id }); artifacts.push(candidate);
    await meta({ source_hash: candidate.hash, image: candidate.image, compile_cpu_ms: candidate.compile_cpu_ms });
    await progress('Compiling', 'Chuẩn bị chương trình thành công.', { cpu_ms: candidate.compile_cpu_ms, stderr: candidate.compile_stderr || '' });
    let reference;
    try { reference = await manager.prepare(sampleSource('python-greedy')); }
    catch (error) { if (error instanceof BotFault) throw new InfrastructureError('reference_compile_error', 'Không chuẩn bị được bot mẫu; không quy lỗi cho bài nộp.'); throw error; }
    artifacts.push(reference);
    await progress('Test match', 'Đấu thử hai ván đổi bên với bot mẫu Python Greedy.');
    for (const candidatePlayer of [0, 1]) {
      const ordered = candidatePlayer === 0 ? [candidate, reference] : [reference, candidate], seed = `submission-${job.id}-side-${candidatePlayer}`;
      let replay;
      try {
        for (const artifact of ordered) sessions.push(await manager.start(artifact, LIMITS));
        replay = await runMatch({ seed, rules: job.rules, onTurn: live, bots: ordered.map((artifact, p) => ({ id: p === candidatePlayer ? `submission-v${job.version}` : 'python-greedy', submission_id: p === candidatePlayer ? job.id : undefined, source_hash: artifact.hash, image: artifact.image })), choose: (player, request) => sessions[player].move(request) });
        verifyReplay(replay);
        await test({ candidatePlayer, seed, replay });
      } finally {
        await live(null);
        const results = await Promise.allSettled(sessions.splice(0).map(session => session.close()));
        const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
      }
      if (replay.fault?.player === candidatePlayer) throw new BotFault(replay.fault.code, replay.fault.message);
      if (replay.fault) throw new InfrastructureError('reference_bot_fault', 'Bot mẫu gặp lỗi; không quy lỗi cho bài nộp.');
    }
    await keep(candidate.directory);
  } finally {
    for (const session of sessions) { try { await session.close(); } catch (error) { failure ||= error; } }
    for (const artifact of artifacts) { try { await manager.dispose(artifact); } catch (error) { failure ||= error; } }
  }
  if (failure) throw failure;
}
module.exports = { runCheck };
