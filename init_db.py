#!/usr/bin/env python3
"""Initialize the content database with the required schema."""

import sqlite3
import os

DB_PATH = os.environ.get("CONTENT_DB", "content.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    tags TEXT,
    title_en TEXT,
    description_en TEXT,
    content_en TEXT,
    title_zh TEXT,
    description_zh TEXT,
    content_zh TEXT,
    embedding TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS style_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    essay_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    round INTEGER DEFAULT 1,
    score_total INTEGER,
    score_presence INTEGER,
    score_surprise INTEGER,
    score_rhythm INTEGER,
    score_depth INTEGER,
    score_resonance INTEGER,
    failure_reason TEXT,
    score_max INTEGER DEFAULT 25,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_style_scores_essay ON style_scores(essay_id);
"""

def main():
    if os.path.exists(DB_PATH):
        print(f"Database already exists at {DB_PATH}")
        conn = sqlite3.connect(DB_PATH)
        count = conn.execute("SELECT COUNT(*) FROM stories").fetchone()[0]
        print(f"  {count} essays in database")
        conn.close()
        return

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.close()
    print(f"Database created at {DB_PATH}")
    print("Ready. Use `python3 pipeline/scripts/rag_essays.py insert --md-file <file>` to add essays.")

if __name__ == "__main__":
    main()
