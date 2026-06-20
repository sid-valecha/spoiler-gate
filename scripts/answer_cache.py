from __future__ import annotations

import argparse
import json
import sqlite3
import time
from pathlib import Path
from typing import Any


CACHE_PATH = Path("data/generated/answer_cache.sqlite")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS answer_cache (
          cache_key TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          offset INTEGER NOT NULL,
          question TEXT NOT NULL,
          answer_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL,
          hits INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.commit()


def get_answer(db_path: Path, cache_key: str) -> dict[str, Any] | None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        ensure_schema(conn)
        row = conn.execute(
            "SELECT answer_json, hits FROM answer_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE answer_cache SET hits = hits + 1, last_used_at = ? WHERE cache_key = ?",
            (int(time.time()), cache_key),
        )
        conn.commit()
        answer = json.loads(row[0])
        answer["cacheHit"] = True
        answer["cacheHits"] = int(row[1]) + 1
        return answer


def put_answer(db_path: Path, cache_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    now = int(time.time())
    with sqlite3.connect(db_path) as conn:
        ensure_schema(conn)
        conn.execute(
            """
            INSERT INTO answer_cache
            (cache_key, book_id, offset, question, answer_json, created_at, last_used_at, hits)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(cache_key) DO UPDATE SET
              answer_json = excluded.answer_json,
              last_used_at = excluded.last_used_at
            """,
            (
                cache_key,
                payload["bookId"],
                int(payload["offset"]),
                payload["question"],
                json.dumps(payload["answer"], ensure_ascii=False),
                now,
                now,
            ),
        )
        conn.commit()
    return {"ok": True}


def main() -> None:
    parser = argparse.ArgumentParser(description="Spoiler Gate answer cache")
    parser.add_argument("--db", type=Path, default=CACHE_PATH)
    subparsers = parser.add_subparsers(dest="command", required=True)

    get_parser = subparsers.add_parser("get")
    get_parser.add_argument("--key", required=True)

    put_parser = subparsers.add_parser("put")
    put_parser.add_argument("--key", required=True)
    put_parser.add_argument("--payload", required=True)

    args = parser.parse_args()
    if args.command == "get":
        result = get_answer(args.db, args.key)
    elif args.command == "put":
        result = put_answer(args.db, args.key, json.loads(args.payload))
    else:
        raise AssertionError(args.command)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
