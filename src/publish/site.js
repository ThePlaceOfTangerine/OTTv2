const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const WEB = path.resolve(__dirname, '../../web'), PUBLIC = path.resolve(__dirname, '../../web-public');
// Cloudflare Pages rejects files over 25 MiB; replays are split by round well before that.
const FILE_LIMIT = 20 * 1024 * 1024;
// Same protection as the portal: Cloudflare Pages only sends what _headers declares (no CSP was seen on the real deploy).
const HEADERS = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
/t/:id/:version/*
  Cache-Control: public, max-age=31536000, immutable
/t/:id/latest.json
  Cache-Control: public, max-age=60
/manifest.json
  Cache-Control: public, max-age=60
/team/*
  Cache-Control: public, max-age=60
/assets/*
  Cache-Control: public, max-age=300
`;

// Rebuilds the whole static site from stored publications; versioned files never change, latest/team files follow the newest publication.
async function buildSite({ db, dir, lookupCode, fileLimit = FILE_LIMIT }) {
  const temporary = `${dir}.tmp-${crypto.randomUUID()}`;
  let files = 0, bytes = 0;
  const write = async (relative, value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const destination = path.join(temporary, ...relative.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, text); files++; bytes += Buffer.byteLength(text);
    return Buffer.byteLength(text);
  };
  try {
    await fs.mkdir(path.join(temporary, 'assets', 'pieces'), { recursive: true });
    for (const name of await fs.readdir(PUBLIC)) await write(name === 'index.html' ? name : `assets/${name}`, await fs.readFile(path.join(PUBLIC, name), 'utf8'));
    for (const name of ['favicon.svg', 'tiles.js', 'tiles.css', 'hints.js', 'replay-nav.js']) await write(`assets/${name}`, await fs.readFile(path.join(WEB, name), 'utf8'));
    for (const name of await fs.readdir(path.join(WEB, 'pieces'))) await write(`assets/pieces/${name}`, await fs.readFile(path.join(WEB, 'pieces', name), 'utf8'));
    await write('_headers', HEADERS);
    const rows = db.prepare('SELECT * FROM publications ORDER BY tournament_id,version').all();
    const latest = new Map();
    for (const row of rows) {
      const snapshot = JSON.parse(row.snapshot_json), base = `t/${row.tournament_id}/v${row.version}`;
      const { bracket, teams, ...summary } = snapshot;
      const published = { summary: `${base}/summary.json`, bracket: null, bracketRounds: [] };
      await write(published.summary, { ...summary, teams: teams.map(({ userId, bot, ...team }) => team) });
      if (bracket) {
        const whole = JSON.stringify(bracket);
        if (Buffer.byteLength(whole) <= fileLimit) { published.bracket = `${base}/bracket.json`; await write(published.bracket, whole); }
        else {
          // Oversized: the bracket file keeps the tree, each round's games (with replays) get their own file.
          const roundOf = new Map(bracket.rounds.flatMap(round => round.matches.map(match => [match.id, round.number])));
          published.bracket = `${base}/bracket.json`; await write(published.bracket, { ...bracket, games: bracket.games.map(({ replay, ...game }) => game) });
          for (const round of bracket.rounds) {
            const file = `${base}/bracket-r${round.number}.json`;
            if (await write(file, { round: round.number, games: bracket.games.filter(game => roundOf.get(game.matchId) === round.number) }) > fileLimit) throw new Error(`Replay lượt ${round.number} vượt giới hạn một file.`);
            published.bracketRounds.push(file);
          }
        }
      }
      latest.set(row.tournament_id, { row, snapshot, files: published });
      await write(`t/${row.tournament_id}/latest.json`, { version: row.version, publishedAt: row.created_at, files: published });
    }
    await write('manifest.json', { generatedAt: Date.now(), tournaments: [...latest.values()].map(({ row, snapshot }) => ({ id: row.tournament_id, name: snapshot.tournament.name,
      status: snapshot.tournament.status, version: row.version, publishedAt: row.created_at })) });
    // One file per team from the newest publication of each tournament; only written when something is published.
    const byTeam = new Map();
    for (const { row, snapshot } of latest.values()) for (const team of snapshot.teams) {
      const entry = byTeam.get(team.userId) || { team: team.team, teamName: team.teamName, tournaments: [] };
      entry.tournaments.push({ id: row.tournament_id, name: snapshot.tournament.name, version: row.version, publishedAt: row.created_at, provisional: !!snapshot.swiss?.provisional,
        rank: team.rank, points: team.points, qualified: team.qualified, seed: team.seed, bracket: team.bracket, bot: team.bot });
      byTeam.set(team.userId, entry);
    }
    for (const [userId, entry] of byTeam) await write(`team/${lookupCode(userId)}.json`, entry);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(temporary, dir);
    return { files, bytes };
  } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
}
module.exports = { buildSite, FILE_LIMIT };
