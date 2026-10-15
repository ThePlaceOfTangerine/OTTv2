const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
  `);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version = 1').get()) {
    db.exec(`BEGIN;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','contestant')),
        locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE TABLE login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      INSERT INTO migrations(version) VALUES (1);
      COMMIT;
    `);
  }
  if (!db.prepare('SELECT 1 FROM migrations WHERE version = 2').get()) {
    db.exec(`BEGIN;
      CREATE TABLE practice_matches (
        id TEXT PRIMARY KEY, created_by INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','finished','bot_error','infrastructure_error')),
        attempts INTEGER NOT NULL DEFAULT 0, seed TEXT NOT NULL,
        rules_json TEXT NOT NULL, bots_json TEXT NOT NULL, replay_json TEXT, error_json TEXT,
        attempt_log_json TEXT NOT NULL DEFAULT '[]'
      );
      INSERT INTO migrations(version) VALUES (2);
      COMMIT;
    `);
  }
  if (!db.prepare('SELECT 1 FROM migrations WHERE version = 3').get()) {
    db.exec(`BEGIN;
      CREATE TABLE bot_submissions (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), version INTEGER NOT NULL,
        filename TEXT NOT NULL, entry TEXT, language TEXT, status TEXT NOT NULL DEFAULT 'Queued'
          CHECK(status IN ('Queued','Scanning','Compiling','Test match','Accepted','Rejected')),
        job_status TEXT NOT NULL DEFAULT 'queued' CHECK(job_status IN ('queued','running','done','blocked')),
        attempts INTEGER NOT NULL DEFAULT 0, worker_id TEXT, lease_until INTEGER,
        available_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        source_hash TEXT, image TEXT, compile_cpu_ms REAL, error_type TEXT, reason_code TEXT, reason TEXT,
        UNIQUE(user_id,version), UNIQUE(id,user_id)
      );
      CREATE INDEX bot_queue ON bot_submissions(job_status,available_at,created_at);
      CREATE TABLE active_bots (
        user_id INTEGER PRIMARY KEY REFERENCES users(id), submission_id TEXT NOT NULL,
        FOREIGN KEY(submission_id,user_id) REFERENCES bot_submissions(id,user_id)
      );
      CREATE TABLE submission_events (
        id INTEGER PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES bot_submissions(id),
        created_at INTEGER NOT NULL, stage TEXT NOT NULL, message TEXT NOT NULL, details_json TEXT
      );
      CREATE TABLE submission_tests (
        id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES bot_submissions(id),
        created_at INTEGER NOT NULL, attempt INTEGER NOT NULL, candidate_player INTEGER NOT NULL,
        seed TEXT NOT NULL, rule_set_id TEXT NOT NULL, rule_set_version INTEGER NOT NULL,
        replay_json TEXT NOT NULL
      );
      INSERT INTO migrations(version) VALUES (3);
      COMMIT;
    `);
  }
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=4').get()) db.exec(`BEGIN;
    CREATE TABLE score_rounds(id TEXT PRIMARY KEY,created_by INTEGER NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,seed TEXT NOT NULL,config_json TEXT NOT NULL,rules_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'running');
    CREATE TABLE score_entrants(round_id TEXT NOT NULL REFERENCES score_rounds(id),user_id INTEGER NOT NULL REFERENCES users(id),username TEXT NOT NULL,submission_id TEXT NOT NULL REFERENCES bot_submissions(id),version INTEGER NOT NULL,rating REAL NOT NULL DEFAULT 1500,played INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,draws INTEGER NOT NULL DEFAULT 0,losses INTEGER NOT NULL DEFAULT 0,points REAL NOT NULL DEFAULT 0,PRIMARY KEY(round_id,user_id));
    CREATE TABLE score_matches(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES score_rounds(id),sequence INTEGER NOT NULL,player0 INTEGER NOT NULL,player1 INTEGER NOT NULL,seed TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,worker_id TEXT,lease_until INTEGER,available_at INTEGER NOT NULL DEFAULT 0,replay_json TEXT,live_json TEXT,error TEXT,scored INTEGER NOT NULL DEFAULT 0,UNIQUE(round_id,sequence));
    CREATE INDEX score_queue ON score_matches(status,available_at);
    CREATE TABLE live_matches(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner_id TEXT NOT NULL,updated_at INTEGER NOT NULL,replay_json TEXT NOT NULL);
    INSERT INTO migrations VALUES(4); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=5').get()) db.exec(`BEGIN;
    ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
    UPDATE users SET must_change_password=1 WHERE role='contestant';
    INSERT INTO migrations VALUES(5); COMMIT;`);
  return db;
}
module.exports = { openDatabase };
