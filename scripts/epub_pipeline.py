from __future__ import annotations

import argparse
import json
import re
import sqlite3
import uuid
import zipfile
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import unquote
from xml.etree import ElementTree

from bs4 import BeautifulSoup


DB_PATH = Path("data/generated/spoiler_gate.sqlite")


def normalize_text(text: str) -> str:
    text = unescape(text)
    text = re.sub(r"[^A-Za-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def _normalize_with_map(text: str) -> tuple[str, list[int]]:
    output: list[str] = []
    mapping: list[int] = []
    last_space = True
    for index, char in enumerate(unescape(text)):
        normalized = char.lower() if char.isalnum() else " "
        if normalized == " ":
            if not last_space:
                output.append(" ")
                mapping.append(index)
            last_space = True
            continue
        output.append(normalized)
        mapping.append(index)
        last_space = False
    if output and output[-1] == " ":
        output.pop()
        mapping.pop()
    return "".join(output), mapping


def _namespace(tag: str) -> str:
    return tag.split("}", 1)[0] + "}" if tag.startswith("{") else ""


def _read_package_path(archive: zipfile.ZipFile) -> str:
    root = ElementTree.fromstring(archive.read("META-INF/container.xml"))
    ns = _namespace(root.tag)
    rootfile = root.find(f".//{ns}rootfile")
    if rootfile is None:
        raise ValueError("EPUB missing rootfile in META-INF/container.xml")
    return unquote(rootfile.attrib["full-path"])


def _text_from_html(html: bytes) -> str:
    soup = BeautifulSoup(html, "lxml")
    for element in soup(["script", "style", "nav"]):
        element.decompose()
    text = soup.get_text("\n")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def extract_epub(epub_path: Path, book_id: str | None = None) -> dict[str, Any]:
    book_id = book_id or epub_path.stem
    with zipfile.ZipFile(epub_path) as archive:
        package_path = _read_package_path(archive)
        package_dir = str(Path(package_path).parent)
        if package_dir == ".":
            package_dir = ""
        package = ElementTree.fromstring(archive.read(package_path))
        ns = _namespace(package.tag)

        def find_text(name: str) -> str:
            node = package.find(f".//{{http://purl.org/dc/elements/1.1/}}{name}")
            return node.text.strip() if node is not None and node.text else ""

        manifest = {}
        for item in package.findall(f".//{ns}manifest/{ns}item"):
            manifest[item.attrib["id"]] = item.attrib["href"]

        chapters: list[dict[str, Any]] = []
        offset = 0
        for itemref in package.findall(f".//{ns}spine/{ns}itemref"):
            href = manifest.get(itemref.attrib["idref"])
            if not href:
                continue
            href_path = str(Path(package_dir) / unquote(href)) if package_dir else unquote(href)
            if href_path not in archive.namelist():
                continue
            text = _text_from_html(archive.read(href_path))
            if len(normalize_text(text).split()) < 8:
                continue
            start = offset
            end = start + len(text)
            title = text.splitlines()[0][:120] if text.splitlines() else f"Chapter {len(chapters) + 1}"
            chapters.append(
                {
                    "id": f"{book_id}-chapter-{len(chapters) + 1}",
                    "chapter_number": len(chapters) + 1,
                    "title": title,
                    "start_offset": start,
                    "end_offset": end,
                    "text": text,
                    "source_path": href_path,
                }
            )
            offset = end

    if not chapters:
        raise ValueError(f"No readable chapters found in {epub_path}")

    return {
        "id": book_id,
        "title": find_text("title") or epub_path.stem.replace("-", " ").title(),
        "author": find_text("creator"),
        "source_label": "User-owned EPUB",
        "chapters": chapters,
    }


def _chunk_chapter(chapter: dict[str, Any], chunk_size: int, overlap: int) -> list[dict[str, Any]]:
    words = list(re.finditer(r"\S+", chapter["text"]))
    chunks = []
    step = max(1, chunk_size - overlap)
    for word_start in range(0, len(words), step):
        word_end = min(len(words), word_start + chunk_size)
        if word_end <= word_start:
            break
        start = chapter["start_offset"] + words[word_start].start()
        end = chapter["start_offset"] + words[word_end - 1].end()
        chunks.append(
            {
                "id": str(uuid.uuid4()),
                "book_id": chapter["book_id"],
                "chapter_number": chapter["chapter_number"],
                "start_offset": start,
                "end_offset": end,
                "text": chapter["text"][words[word_start].start() : words[word_end - 1].end()],
            }
        )
        if word_end == len(words):
            break
    return chunks


def _summary(text: str, max_words: int = 90) -> str:
    words = text.split()
    return " ".join(words[:max_words])


def build_database(
    epub_path: Path,
    db_path: Path = DB_PATH,
    book_id: str | None = None,
    chunk_size: int = 180,
    overlap: int = 35,
) -> dict[str, Any]:
    book = extract_epub(epub_path, book_id)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE books (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              author TEXT,
              source_label TEXT NOT NULL
            );
            CREATE TABLE chapters (
              id TEXT PRIMARY KEY,
              book_id TEXT NOT NULL,
              chapter_number INTEGER NOT NULL,
              title TEXT,
              start_offset INTEGER NOT NULL,
              end_offset INTEGER NOT NULL,
              summary TEXT NOT NULL,
              text TEXT NOT NULL
            );
            CREATE TABLE chunks (
              id TEXT PRIMARY KEY,
              book_id TEXT NOT NULL,
              chapter_number INTEGER NOT NULL,
              start_offset INTEGER NOT NULL,
              end_offset INTEGER NOT NULL,
              text TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE chunks_fts USING fts5(text, chunk_id UNINDEXED);
            """
        )
        conn.execute(
            "INSERT INTO books (id, title, author, source_label) VALUES (?, ?, ?, ?)",
            (book["id"], book["title"], book["author"], book["source_label"]),
        )
        chunk_count = 0
        for chapter in book["chapters"]:
            chapter["book_id"] = book["id"]
            conn.execute(
                """
                INSERT INTO chapters
                (id, book_id, chapter_number, title, start_offset, end_offset, summary, text)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chapter["id"],
                    book["id"],
                    chapter["chapter_number"],
                    chapter["title"],
                    chapter["start_offset"],
                    chapter["end_offset"],
                    _summary(chapter["text"]),
                    chapter["text"],
                ),
            )
            for chunk in _chunk_chapter(chapter, chunk_size, overlap):
                chunk_count += 1
                conn.execute(
                    """
                    INSERT INTO chunks
                    (id, book_id, chapter_number, start_offset, end_offset, text)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk["id"],
                        chunk["book_id"],
                        chunk["chapter_number"],
                        chunk["start_offset"],
                        chunk["end_offset"],
                        chunk["text"],
                    ),
                )
                conn.execute(
                    "INSERT INTO chunks_fts (text, chunk_id) VALUES (?, ?)",
                    (chunk["text"], chunk["id"]),
                )
        conn.commit()

    return {
        "book_id": book["id"],
        "title": book["title"],
        "chapters": len(book["chapters"]),
        "chunks": chunk_count,
        "db_path": str(db_path),
    }


def _book_text(conn: sqlite3.Connection, book_id: str) -> tuple[str, list[sqlite3.Row]]:
    conn.row_factory = sqlite3.Row
    chapters = conn.execute(
        "SELECT * FROM chapters WHERE book_id = ? ORDER BY chapter_number",
        (book_id,),
    ).fetchall()
    if not chapters:
        raise ValueError(f"Book not found: {book_id}")
    parts = []
    for chapter in chapters:
        gap = chapter["start_offset"] - sum(len(part) for part in parts)
        if gap > 0:
            parts.append(" " * gap)
        parts.append(chapter["text"])
    return "".join(parts), chapters


def _candidate_phrases(page_text: str) -> list[str]:
    words = normalize_text(page_text).split()
    phrases = []
    for size in (20, 16, 12, 8, 5):
        if len(words) >= size:
            midpoint = max(0, (len(words) - size) // 2)
            phrases.append(" ".join(words[midpoint : midpoint + size]))
            phrases.append(" ".join(words[:size]))
            phrases.append(" ".join(words[-size:]))
    return list(dict.fromkeys(phrase for phrase in phrases if phrase))


def locate_progress(db_path: Path, book_id: str, page_text: str) -> dict[str, Any]:
    if len(normalize_text(page_text).split()) < 5:
        raise ValueError("Need at least five readable words to locate progress")
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        full_text, chapters = _book_text(conn, book_id)
        normalized_book, offset_map = _normalize_with_map(full_text)
        matched_ranges: list[tuple[int, int, str]] = []
        for phrase in _candidate_phrases(page_text):
            index = normalized_book.find(phrase)
            if index < 0:
                continue
            matched_ranges.append((index, min(len(offset_map) - 1, index + len(phrase) - 1), phrase))
        if matched_ranges:
            first_index = min(start for start, _, _ in matched_ranges)
            last_index = max(end for _, end, _ in matched_ranges)
            original_offset = offset_map[first_index]
            boundary_offset = min(len(full_text), offset_map[last_index] + 1)
            chapter = next(c for c in chapters if c["start_offset"] <= boundary_offset <= c["end_offset"])
            longest_phrase = max((phrase for _, _, phrase in matched_ranges), key=lambda p: len(p.split()))
            confidence = min(0.98, 0.55 + len(longest_phrase.split()) / 40 + len(matched_ranges) / 20)
            best = {
                "book_id": book_id,
                "chapter_number": chapter["chapter_number"],
                "chapter_title": chapter["title"],
                "offset": boundary_offset,
                "confidence": round(confidence, 2),
                "matched_text": full_text[original_offset : original_offset + 260],
                "method": "substring",
            }
            return best

        terms = [word for word in normalize_text(page_text).split() if len(word) > 3][:8]
        if not terms:
            raise ValueError("Could not derive search terms from page text")
        query = " OR ".join(terms)
        row = conn.execute(
            """
            SELECT chunks.* FROM chunks_fts
            JOIN chunks ON chunks_fts.chunk_id = chunks.id
            WHERE chunks.book_id = ? AND chunks_fts MATCH ?
            LIMIT 1
            """,
            (book_id, query),
        ).fetchone()
        if row is None:
            raise ValueError("Could not locate page text in selected book")
        chapter = next(c for c in chapters if c["chapter_number"] == row["chapter_number"])
        return {
            "book_id": book_id,
            "chapter_number": row["chapter_number"],
            "chapter_title": chapter["title"],
            "offset": row["end_offset"],
            "confidence": 0.45,
            "matched_text": row["text"],
            "method": "fts",
        }


def retrieve_context(db_path: Path, book_id: str, offset: int, question: str) -> dict[str, Any]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        book = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        if book is None:
            raise ValueError(f"Book not found: {book_id}")
        chapter = conn.execute(
            """
            SELECT * FROM chapters
            WHERE book_id = ? AND start_offset <= ? AND end_offset >= ?
            ORDER BY chapter_number
            LIMIT 1
            """,
            (book_id, offset, offset),
        ).fetchone()
        summaries = conn.execute(
            """
            SELECT chapter_number, title, summary, end_offset FROM chapters
            WHERE book_id = ? AND end_offset <= ?
            ORDER BY chapter_number
            """,
            (book_id, offset),
        ).fetchall()
        chunks: list[sqlite3.Row] = []
        terms = [word for word in normalize_text(question).split() if len(word) > 3][:8]
        if terms:
            try:
                chunks.extend(
                    conn.execute(
                        """
                        SELECT chunks.* FROM chunks_fts
                        JOIN chunks ON chunks_fts.chunk_id = chunks.id
                        WHERE chunks.book_id = ? AND chunks.end_offset <= ? AND chunks_fts MATCH ?
                        LIMIT 5
                        """,
                        (book_id, offset, " OR ".join(terms)),
                    ).fetchall()
                )
            except sqlite3.OperationalError:
                pass
        chunks.extend(
            conn.execute(
                """
                SELECT * FROM chunks
                WHERE book_id = ? AND end_offset <= ?
                ORDER BY end_offset DESC
                LIMIT 5
                """,
                (book_id, offset),
            ).fetchall()
        )

    seen = set()
    safe_chunks = []
    for chunk in chunks:
        if chunk["id"] in seen:
            continue
        seen.add(chunk["id"])
        safe_chunks.append(
            {
                "id": chunk["id"],
                "chapter_number": chunk["chapter_number"],
                "start_offset": chunk["start_offset"],
                "end_offset": chunk["end_offset"],
                "text": chunk["text"],
            }
        )
    safe_chunks.sort(key=lambda item: item["end_offset"], reverse=True)
    return {
        "book": dict(book),
        "current_chapter": dict(chapter) if chapter else None,
        "offset": offset,
        "summaries": [dict(row) for row in summaries],
        "chunks": safe_chunks[:8],
    }


def demo_snippet(db_path: Path, book_id: str, stage: str) -> dict[str, Any]:
    if stage not in {"early", "late"}:
        raise ValueError("stage must be early or late")
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        if stage == "early":
            row = conn.execute(
                """
                SELECT * FROM chunks
                WHERE book_id = ?
                  AND chapter_number BETWEEN 13 AND 15
                  AND text LIKE '%Snape%'
                ORDER BY start_offset
                LIMIT 1
                """,
                (book_id,),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT * FROM chunks
                WHERE book_id = ?
                  AND chapter_number = 22
                  AND text LIKE '%Quirrell%'
                  AND text LIKE '%Snape%'
                  AND (text LIKE '%trying to save%' OR text LIKE '%never wanted%')
                ORDER BY start_offset
                LIMIT 1
                """,
                (book_id,),
            ).fetchone()
        if row is None:
            row = conn.execute(
                """
                SELECT * FROM chunks
                WHERE book_id = ?
                ORDER BY start_offset
                LIMIT 1
                """,
                (book_id,),
            ).fetchone()
        if row is None:
            raise ValueError(f"No chunks found for {book_id}")
        return {
            "stage": stage,
            "book_id": book_id,
            "chapter_number": row["chapter_number"],
            "start_offset": row["start_offset"],
            "end_offset": row["end_offset"],
            "text": row["text"],
        }


def list_books(db_path: Path) -> list[dict[str, Any]]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute("SELECT * FROM books ORDER BY title")]


def main() -> None:
    parser = argparse.ArgumentParser(description="Spoiler Gate EPUB pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest")
    ingest.add_argument("epub", type=Path)
    ingest.add_argument("--db", type=Path, default=DB_PATH)
    ingest.add_argument("--book-id", default=None)

    locate = subparsers.add_parser("locate")
    locate.add_argument("--db", type=Path, default=DB_PATH)
    locate.add_argument("--book-id", required=True)
    locate.add_argument("--text", required=True)

    context = subparsers.add_parser("context")
    context.add_argument("--db", type=Path, default=DB_PATH)
    context.add_argument("--book-id", required=True)
    context.add_argument("--offset", type=int, required=True)
    context.add_argument("--question", required=True)

    books = subparsers.add_parser("books")
    books.add_argument("--db", type=Path, default=DB_PATH)

    snippet = subparsers.add_parser("snippet")
    snippet.add_argument("--db", type=Path, default=DB_PATH)
    snippet.add_argument("--book-id", required=True)
    snippet.add_argument("--stage", choices=["early", "late"], required=True)

    args = parser.parse_args()
    if args.command == "ingest":
        result = build_database(args.epub, args.db, args.book_id)
    elif args.command == "locate":
        result = locate_progress(args.db, args.book_id, args.text)
    elif args.command == "context":
        result = retrieve_context(args.db, args.book_id, args.offset, args.question)
    elif args.command == "books":
        result = list_books(args.db)
    elif args.command == "snippet":
        result = demo_snippet(args.db, args.book_id, args.stage)
    else:
        raise AssertionError(args.command)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
