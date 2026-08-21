// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// SQLite index — NOT a source of truth. Markdown in reports/ and the vault
// stays canonical (it feeds Obsidian recall); this database is a queryable
// index rebuilt from those files whenever they change. Losing it costs
// nothing but a rebuild.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { JARVIS_DIR } from "../config.js";

const DATA_DIR = path.join(JARVIS_DIR, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db: Database.Database = new Database(path.join(DATA_DIR, "jarvis.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS action_items (
    call_id      TEXT    NOT NULL,
    idx          INTEGER NOT NULL,
    owner        TEXT    NOT NULL,
    text         TEXT    NOT NULL,
    done         INTEGER NOT NULL,
    call_title   TEXT    NOT NULL,
    call_started TEXT    NOT NULL,
    PRIMARY KEY (call_id, idx)
  );
  CREATE INDEX IF NOT EXISTS idx_actions_done ON action_items (done);
`);
try { db.exec("ALTER TABLE action_items ADD COLUMN comments TEXT NOT NULL DEFAULT '[]'"); } catch {}
