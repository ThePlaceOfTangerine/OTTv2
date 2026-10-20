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
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=6').get()) db.exec(`BEGIN;
    CREATE TABLE rule_sets(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE rule_versions(rule_set_id TEXT NOT NULL REFERENCES rule_sets(id),version INTEGER NOT NULL,rules_json TEXT NOT NULL,created_by INTEGER REFERENCES users(id),created_at INTEGER NOT NULL,PRIMARY KEY(rule_set_id,version));
    CREATE TRIGGER rule_versions_immutable_update BEFORE UPDATE ON rule_versions BEGIN SELECT RAISE(ABORT,'Rule versions are immutable'); END;
    CREATE TRIGGER rule_versions_immutable_delete BEFORE DELETE ON rule_versions BEGIN SELECT RAISE(ABORT,'Rule versions are immutable'); END;
    ALTER TABLE practice_matches ADD COLUMN rule_set_id TEXT;
    ALTER TABLE practice_matches ADD COLUMN rule_set_version INTEGER;
    ALTER TABLE practice_matches ADD COLUMN bot_snapshots_json TEXT;
    UPDATE practice_matches SET rule_set_id=json_extract(rules_json,'$.id'),rule_set_version=json_extract(rules_json,'$.version');
    INSERT INTO migrations VALUES(6); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=7').get()) db.exec(`BEGIN;
    ALTER TABLE users ADD COLUMN deleted_at INTEGER;
    CREATE INDEX users_visible ON users(role,deleted_at);
    INSERT INTO migrations VALUES(7); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=8').get()) db.exec(`BEGIN;
    CREATE TABLE tournaments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submissions_open','closing','locked','running','provisional','finished','cancelled')),
      revision INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      rule_set_id TEXT NOT NULL, rule_set_version INTEGER NOT NULL,
      config_json TEXT NOT NULL, opens_at INTEGER, closes_at INTEGER,
      FOREIGN KEY(rule_set_id,rule_set_version) REFERENCES rule_versions(rule_set_id,version),
      CHECK(opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at)
    );
    CREATE TABLE tournament_entrants (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id), user_id INTEGER NOT NULL REFERENCES users(id),
      username TEXT NOT NULL, joined_at INTEGER NOT NULL,
      PRIMARY KEY(tournament_id,user_id)
    );
    CREATE INDEX tournament_user ON tournament_entrants(user_id,tournament_id);
    CREATE TABLE tournament_events (
      id INTEGER PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
      actor_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
      kind TEXT NOT NULL, details_json TEXT NOT NULL
    );
    CREATE INDEX tournament_history ON tournament_events(tournament_id,id);
    INSERT INTO migrations VALUES(8); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=9').get()) db.exec(`BEGIN;
    CREATE TABLE tournament_stages (
      id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
      kind TEXT NOT NULL CHECK(kind='qualifier'), status TEXT NOT NULL CHECK(status IN ('open','closing','locked')),
      opens_at INTEGER NOT NULL, closes_at INTEGER NOT NULL, locked_at INTEGER,
      rules_json TEXT NOT NULL, config_json TEXT NOT NULL,
      UNIQUE(tournament_id,kind), CHECK(opens_at<closes_at)
    );
    ALTER TABLE bot_submissions ADD COLUMN stage_id TEXT REFERENCES tournament_stages(id);
    ALTER TABLE bot_submissions ADD COLUMN idempotency_key TEXT;
    ALTER TABLE bot_submissions ADD COLUMN upload_hash TEXT;
    CREATE UNIQUE INDEX stage_receipt_key ON bot_submissions(stage_id,user_id,idempotency_key);
    CREATE INDEX stage_submission_queue ON bot_submissions(stage_id,job_status,user_id);
    CREATE TABLE tournament_stage_entrants (
      stage_id TEXT NOT NULL REFERENCES tournament_stages(id), user_id INTEGER NOT NULL REFERENCES users(id),
      username TEXT NOT NULL, preferred_submission_id TEXT, locked_submission_id TEXT,
      snapshot_json TEXT, exclusion_reason TEXT,
      PRIMARY KEY(stage_id,user_id),
      FOREIGN KEY(preferred_submission_id,user_id) REFERENCES bot_submissions(id,user_id),
      FOREIGN KEY(locked_submission_id,user_id) REFERENCES bot_submissions(id,user_id)
    );
    CREATE TRIGGER stage_rules_immutable BEFORE UPDATE OF rules_json,config_json,opens_at ON tournament_stages
      BEGIN SELECT RAISE(ABORT,'Stage configuration is immutable'); END;
    CREATE TRIGGER locked_stage_entrants_update BEFORE UPDATE ON tournament_stage_entrants
      WHEN (SELECT status FROM tournament_stages WHERE id=OLD.stage_id)='locked'
      BEGIN SELECT RAISE(ABORT,'Locked bots are immutable'); END;
    CREATE TRIGGER locked_stage_entrants_delete BEFORE DELETE ON tournament_stage_entrants
      WHEN (SELECT status FROM tournament_stages WHERE id=OLD.stage_id)='locked'
      BEGIN SELECT RAISE(ABORT,'Locked bots are immutable'); END;
    CREATE TRIGGER locked_stage_entrants_insert BEFORE INSERT ON tournament_stage_entrants
      WHEN (SELECT status FROM tournament_stages WHERE id=NEW.stage_id)='locked'
      BEGIN SELECT RAISE(ABORT,'Locked bots are immutable'); END;
    INSERT INTO migrations VALUES(9); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=10').get()) db.exec(`BEGIN;
    CREATE TABLE swiss_sessions (
      stage_id TEXT PRIMARY KEY REFERENCES tournament_stages(id), seed TEXT NOT NULL,
      rounds INTEGER NOT NULL, games_per_pair INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('running','finished')), created_at INTEGER NOT NULL
    );
    CREATE TABLE swiss_rounds (
      id TEXT PRIMARY KEY, stage_id TEXT NOT NULL REFERENCES swiss_sessions(stage_id),
      number INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','finished')),
      UNIQUE(stage_id,number)
    );
    CREATE TABLE swiss_pairs (
      id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES swiss_rounds(id),
      user0 INTEGER NOT NULL REFERENCES users(id), user1 INTEGER REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('queued','finished')),
      result0_units INTEGER, result1_units INTEGER, game0_units INTEGER, game1_units INTEGER,
      CHECK(user1 IS NULL OR user0<>user1)
    );
    CREATE INDEX swiss_pair_round ON swiss_pairs(round_id);
    CREATE TABLE swiss_games (
      id TEXT PRIMARY KEY, pair_id TEXT NOT NULL REFERENCES swiss_pairs(id), number INTEGER NOT NULL,
      player0 INTEGER NOT NULL REFERENCES users(id), player1 INTEGER NOT NULL REFERENCES users(id), seed TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','finished','blocked')),
      attempts INTEGER NOT NULL DEFAULT 0, worker_id TEXT, lease_until INTEGER, available_at INTEGER NOT NULL DEFAULT 0,
      replay_json TEXT, live_json TEXT, error TEXT, UNIQUE(pair_id,number)
    );
    CREATE INDEX swiss_job_queue ON swiss_games(status,available_at);
    INSERT INTO migrations VALUES(10); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=11').get()) db.exec(`BEGIN;
    CREATE TABLE tournament_qualifications (
      tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id), stage_id TEXT NOT NULL REFERENCES tournament_stages(id),
      approved_by INTEGER NOT NULL REFERENCES users(id), approved_at INTEGER NOT NULL,
      top_n INTEGER NOT NULL CHECK(top_n>=2), swiss_revision INTEGER NOT NULL,
      reason TEXT NOT NULL, snapshot_json TEXT NOT NULL
    );
    CREATE TRIGGER qualifications_immutable_update BEFORE UPDATE ON tournament_qualifications
      BEGIN SELECT RAISE(ABORT,'Qualification is immutable'); END;
    CREATE TRIGGER qualifications_immutable_delete BEFORE DELETE ON tournament_qualifications
      BEGIN SELECT RAISE(ABORT,'Qualification is immutable'); END;
    INSERT INTO migrations VALUES(11); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=12').get()) db.exec(`BEGIN;
    CREATE TABLE tournament_brackets (
      tournament_id TEXT PRIMARY KEY REFERENCES tournament_qualifications(tournament_id),
      created_by INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
      reason TEXT NOT NULL, plan_json TEXT NOT NULL
    );
    CREATE TRIGGER bracket_plan_immutable_update BEFORE UPDATE ON tournament_brackets
      BEGIN SELECT RAISE(ABORT,'Bracket plan is immutable'); END;
    CREATE TRIGGER bracket_plan_immutable_delete BEFORE DELETE ON tournament_brackets
      BEGIN SELECT RAISE(ABORT,'Bracket plan is immutable'); END;
    INSERT INTO migrations VALUES(12); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=13').get()) db.exec(`BEGIN;
    CREATE TABLE bracket_runs (
      tournament_id TEXT PRIMARY KEY REFERENCES tournament_brackets(tournament_id),
      status TEXT NOT NULL CHECK(status IN ('running','finished')), revision INTEGER NOT NULL,
      state_json TEXT NOT NULL, source_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      published_at INTEGER, published_by INTEGER REFERENCES users(id)
    );
    CREATE TABLE bracket_games (
      id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES bracket_runs(tournament_id), match_id TEXT NOT NULL,
      number INTEGER NOT NULL, player0 INTEGER NOT NULL REFERENCES users(id), player1 INTEGER NOT NULL REFERENCES users(id), seed TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','finished','blocked')),
      attempts INTEGER NOT NULL DEFAULT 0, worker_id TEXT, lease_until INTEGER, available_at INTEGER NOT NULL DEFAULT 0,
      replay_json TEXT, live_json TEXT, error TEXT, UNIQUE(tournament_id,match_id,number)
    );
    CREATE INDEX bracket_job_queue ON bracket_games(status,available_at);
    CREATE TRIGGER bracket_source_immutable BEFORE UPDATE OF source_json ON bracket_runs
      BEGIN SELECT RAISE(ABORT,'Bracket source is immutable'); END;
    INSERT INTO migrations VALUES(13); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=14').get()) db.exec(`BEGIN;
    CREATE TABLE tournament_final_rules (
      tournament_id TEXT PRIMARY KEY REFERENCES tournament_qualifications(tournament_id),
      rule_set_id TEXT NOT NULL, rule_set_version INTEGER NOT NULL,
      rules_json TEXT NOT NULL, requires_resubmission INTEGER NOT NULL CHECK(requires_resubmission IN (0,1)),
      pinned_by INTEGER NOT NULL REFERENCES users(id), pinned_at INTEGER NOT NULL, reason TEXT NOT NULL,
      FOREIGN KEY(rule_set_id,rule_set_version) REFERENCES rule_versions(rule_set_id,version)
    );
    CREATE TRIGGER final_rules_immutable_update BEFORE UPDATE ON tournament_final_rules
      BEGIN SELECT RAISE(ABORT,'Final rules are immutable'); END;
    CREATE TRIGGER final_rules_immutable_delete BEFORE DELETE ON tournament_final_rules
      BEGIN SELECT RAISE(ABORT,'Final rules are immutable'); END;
    INSERT INTO migrations VALUES(14); COMMIT;`);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=15').get()) {
    // Rebuild the checked stage table without renaming its referenced identity.
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try {
      db.exec(`DROP TRIGGER stage_rules_immutable;
        DROP TRIGGER locked_stage_entrants_update; DROP TRIGGER locked_stage_entrants_delete; DROP TRIGGER locked_stage_entrants_insert;
        CREATE TABLE tournament_stages_new (
          id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
          kind TEXT NOT NULL CHECK(kind IN ('qualifier','final')), status TEXT NOT NULL CHECK(status IN ('open','closing','locked')),
          opens_at INTEGER NOT NULL, closes_at INTEGER NOT NULL, locked_at INTEGER,
          rules_json TEXT NOT NULL, config_json TEXT NOT NULL,
          UNIQUE(tournament_id,kind), CHECK(opens_at<closes_at)
        );
        INSERT INTO tournament_stages_new SELECT * FROM tournament_stages;
        DROP TABLE tournament_stages;
        ALTER TABLE tournament_stages_new RENAME TO tournament_stages;
        CREATE TRIGGER stage_rules_immutable BEFORE UPDATE OF rules_json,config_json,opens_at ON tournament_stages
          BEGIN SELECT RAISE(ABORT,'Stage configuration is immutable'); END;
        CREATE TRIGGER locked_stage_entrants_update BEFORE UPDATE ON tournament_stage_entrants
          WHEN (SELECT status FROM tournament_stages WHERE id=OLD.stage_id)='locked'
          BEGIN SELECT RAISE(ABORT,'Locked bots are immutable'); END;
        CREATE TRIGGER locked_stage_entrants_delete BEFORE DELETE ON tournament_stage_entrants
          WHEN (SELECT status FROM tournament_stages WHERE id=OLD.stage_id)='locked'
          BEGIN SELECT RAISE(ABORT,'Locked bots are immutable'); END;
        CREATE TRIGGER locked_stage_entrants_insert BEFORE INSERT ON tournament_stage_entrants
          WHEN (SELECT status FROM tournament_stages WHERE id=NEW.stage_id)='locked'
          BEGIN SELECT RAISE(ABORT,'Locked bots are immutable'); END;
        CREATE TABLE tournament_final_intakes (
          tournament_id TEXT PRIMARY KEY REFERENCES tournament_final_rules(tournament_id),
          stage_id TEXT NOT NULL UNIQUE REFERENCES tournament_stages(id),
          announced_by INTEGER NOT NULL REFERENCES users(id), announced_at INTEGER NOT NULL,
          announcement TEXT NOT NULL, fallback_policy TEXT NOT NULL CHECK(fallback_policy='require_valid_final_submission')
        );`);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Stage migration would break existing references');
      db.exec('INSERT INTO migrations VALUES(15); COMMIT;');
    } catch (error) { db.exec('ROLLBACK;'); throw error; }
    finally { db.exec('PRAGMA foreign_keys=ON;'); }
  }
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=16').get()) db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE swiss_controls (
      stage_id TEXT PRIMARY KEY REFERENCES swiss_sessions(stage_id),
      status TEXT NOT NULL CHECK(status IN ('paused','cancelled')),
      reason TEXT NOT NULL, changed_at INTEGER NOT NULL
    );
    INSERT INTO migrations VALUES(16);
    COMMIT;
  `);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=17').get()) db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE team_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id), team_name TEXT NOT NULL, leader_email TEXT NOT NULL,
      members_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL
    );
    CREATE TABLE team_repos (
      user_id INTEGER PRIMARY KEY REFERENCES users(id), full_name TEXT NOT NULL, repo_id INTEGER,
      verify_code TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','verified')),
      installation_id INTEGER, default_branch TEXT, verified_at INTEGER, updated_at INTEGER NOT NULL
    );
    -- Only a verified claim reserves a repository, so a pending forgery cannot block its owner.
    CREATE UNIQUE INDEX team_repos_verified ON team_repos(repo_id) WHERE status='verified';
    CREATE TABLE repo_pushes (
      delivery_id TEXT PRIMARY KEY, repo_id INTEGER NOT NULL, ref TEXT NOT NULL, sha TEXT NOT NULL, received_at INTEGER NOT NULL
    );
    CREATE INDEX repo_pushes_lookup ON repo_pushes(repo_id, ref, received_at);
    CREATE TABLE repo_snapshots (
      stage_id TEXT NOT NULL REFERENCES tournament_stages(id), user_id INTEGER NOT NULL REFERENCES users(id),
      sha TEXT, source TEXT NOT NULL, submission_id TEXT REFERENCES bot_submissions(id), error TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY(stage_id, user_id)
    );
    ALTER TABLE bot_submissions ADD COLUMN repo_full_name TEXT;
    ALTER TABLE bot_submissions ADD COLUMN commit_sha TEXT;
    ALTER TABLE bot_submissions ADD COLUMN origin TEXT;
    CREATE UNIQUE INDEX submissions_commit ON bot_submissions(user_id, COALESCE(stage_id,''), commit_sha) WHERE commit_sha IS NOT NULL;
    CREATE INDEX submissions_sha ON bot_submissions(commit_sha) WHERE commit_sha IS NOT NULL;
    INSERT INTO migrations VALUES(17);
    COMMIT;
  `);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=18').get()) db.exec(`
    BEGIN IMMEDIATE;
    -- The secret signs requests (HMAC) and never travels; protect the database file itself.
    CREATE TABLE graders (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL, created_at INTEGER NOT NULL,
      revoked_at INTEGER, last_seen_at INTEGER, image TEXT, slots INTEGER
    );
    CREATE TABLE grader_nonces (
      grader_id TEXT NOT NULL REFERENCES graders(id), nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(grader_id, nonce)
    );
    CREATE INDEX grader_nonces_expiry ON grader_nonces(expires_at);
    INSERT INTO migrations VALUES(18);
    COMMIT;
  `);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=19').get()) db.exec(`
    BEGIN IMMEDIATE;
    -- Long-lived secrets created once (e.g. the team lookup HMAC key) so they survive restarts and moves with the database.
    CREATE TABLE app_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE publications (
      id INTEGER PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id), version INTEGER NOT NULL,
      created_at INTEGER NOT NULL, created_by INTEGER REFERENCES users(id), trigger TEXT NOT NULL CHECK(trigger IN ('manual','schedule')),
      reason TEXT NOT NULL, snapshot_json TEXT NOT NULL, UNIQUE(tournament_id, version)
    );
    CREATE TRIGGER publications_immutable_update BEFORE UPDATE ON publications BEGIN SELECT RAISE(ABORT,'Publications are immutable'); END;
    CREATE TRIGGER publications_immutable_delete BEFORE DELETE ON publications BEGIN SELECT RAISE(ABORT,'Publications are immutable'); END;
    CREATE TABLE publication_schedules (
      id INTEGER PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id), publish_at INTEGER NOT NULL, reason TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','skipped','cancelled','failed')), publication_id INTEGER REFERENCES publications(id),
      note TEXT, finished_at INTEGER
    );
    CREATE INDEX publication_schedules_due ON publication_schedules(status, publish_at);
    CREATE TABLE publication_controls (
      tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id), auto_paused INTEGER NOT NULL CHECK(auto_paused IN (0,1)),
      reason TEXT NOT NULL, changed_by INTEGER REFERENCES users(id), changed_at INTEGER NOT NULL
    );
    CREATE TABLE sheet_syncs (
      publication_id INTEGER PRIMARY KEY REFERENCES publications(id), status TEXT NOT NULL CHECK(status IN ('queued','done','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE site_deploys (
      id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL CHECK(status IN ('running','done','failed','blocked')), output TEXT
    );
    INSERT INTO migrations VALUES(19);
    COMMIT;
  `);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=20').get()) db.exec(`
    BEGIN IMMEDIATE;
    -- This machine's Ed25519 identity for signing bundles (created once; travels with snapshots so a standby keeps it).
    CREATE TABLE sync_identity (id INTEGER PRIMARY KEY CHECK(id=1), node_id TEXT NOT NULL, name TEXT NOT NULL, public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE sync_peers (node_id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL, added_by INTEGER, added_at INTEGER NOT NULL);
    -- Which machine may write a scope ('system' or 'tournament:<id>'); no row means this machine.
    CREATE TABLE sync_authority (scope TEXT PRIMARY KEY, node_id TEXT NOT NULL, changed_at INTEGER NOT NULL, note TEXT);
    -- Last row version exchanged with each peer, so an incremental bundle carries only changes and deletions.
    CREATE TABLE sync_state (peer TEXT NOT NULL, table_name TEXT NOT NULL, row_key TEXT NOT NULL, scope TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(peer, table_name, row_key));
    CREATE TABLE sync_bundles (bundle_id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('export','import')), peer TEXT NOT NULL, kind TEXT NOT NULL,
      created_at INTEGER NOT NULL, actor INTEGER, records INTEGER NOT NULL, report_json TEXT);
    INSERT INTO migrations VALUES(20);
    COMMIT;
  `);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=21').get()) db.exec(`
    BEGIN IMMEDIATE;
    -- Team whose bot fault decided the game (badge "Bot mẫu mực"); kept as a column so standings never parse replays.
    ALTER TABLE swiss_games ADD COLUMN fault_user INTEGER REFERENCES users(id);
    UPDATE swiss_games SET fault_user=CASE json_extract(replay_json,'$.fault.player') WHEN 0 THEN player0 WHEN 1 THEN player1 END
      WHERE status='finished' AND replay_json IS NOT NULL;
    INSERT INTO migrations VALUES(21);
    COMMIT;
  `);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=22').get()) db.exec(`
    BEGIN IMMEDIATE;
    -- Enrollment windows for USB graders (D15): one code, many machines, each gets its own HMAC key. Machine-local like graders; only the code hash is kept.
    CREATE TABLE grader_enrollments (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, name_prefix TEXT NOT NULL, max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 500),
      uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, closed_at INTEGER, created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL);
    ALTER TABLE graders ADD COLUMN enrollment_id TEXT REFERENCES grader_enrollments(id);
    INSERT INTO migrations VALUES(22);
    COMMIT;
  `);
  return db;
}
module.exports = { openDatabase };
