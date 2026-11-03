import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.FEEDSTER_DATA || path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'feedster.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    site_url TEXT,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    etag TEXT,
    last_modified TEXT,
    last_fetched INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    url TEXT,
    title TEXT,
    author TEXT,
    content TEXT,
    image TEXT,
    published INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    starred INTEGER NOT NULL DEFAULT 0,
    UNIQUE (feed_id, guid)
  );

  CREATE INDEX IF NOT EXISTS articles_feed_pub ON articles (feed_id, published DESC);
  CREATE INDEX IF NOT EXISTS articles_pub ON articles (published DESC, id DESC);
  CREATE INDEX IF NOT EXISTS articles_unread ON articles (read, feed_id);
  CREATE INDEX IF NOT EXISTS articles_starred ON articles (starred) WHERE starred = 1;
`);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
