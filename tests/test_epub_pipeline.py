import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.epub_pipeline import (
    build_database,
    export_corpus,
    extract_epub,
    locate_progress,
    normalize_text,
    retrieve_context,
)


def write_mini_epub(path: Path) -> None:
    container = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""
    package = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Mini Mystery</dc:title>
    <dc:creator>A. Tester</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>
"""
    chapter1 = """<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>Chapter One</h1>
<p>Alice met the masked visitor at noon. The visitor wore a blue ring.</p>
<p>The hidden door stayed closed.</p>
</body></html>"""
    chapter2 = """<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>Chapter Two</h1>
<p>The masked visitor was revealed to be the queen in disguise.</p>
<p>The hidden door opened after midnight.</p>
</body></html>"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OPS/package.opf", package)
        archive.writestr("OPS/chapter1.xhtml", chapter1)
        archive.writestr("OPS/chapter2.xhtml", chapter2)


class EpubPipelineTests(unittest.TestCase):
    def test_extract_epub_preserves_spine_order_and_offsets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            epub_path = Path(tmp) / "mini.epub"
            write_mini_epub(epub_path)

            book = extract_epub(epub_path, "mini")

            self.assertEqual(book["title"], "Mini Mystery")
            self.assertEqual([c["chapter_number"] for c in book["chapters"]], [1, 2])
            self.assertIn("masked visitor at noon", book["chapters"][0]["text"])
            self.assertLess(book["chapters"][0]["start_offset"], book["chapters"][1]["start_offset"])
            self.assertEqual(book["chapters"][0]["end_offset"], book["chapters"][1]["start_offset"])

    def test_normalize_text_collapses_punctuation_and_whitespace(self) -> None:
        self.assertEqual(
            normalize_text("  The masked\nvisitor's   BLUE-ring! "),
            "the masked visitor s blue ring",
        )

    def test_locate_progress_finds_offset_from_page_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            epub_path = Path(tmp) / "mini.epub"
            db_path = Path(tmp) / "mini.sqlite"
            write_mini_epub(epub_path)
            build_database(epub_path, db_path, "mini")

            result = locate_progress(
                db_path,
                "mini",
                "The visitor wore a blue ring. The hidden door stayed closed.",
            )

            self.assertEqual(result["chapter_number"], 1)
            self.assertGreaterEqual(result["confidence"], 0.7)
            self.assertIn("blue ring", result["matched_text"].lower())

    def test_retrieve_context_never_returns_future_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            epub_path = Path(tmp) / "mini.epub"
            db_path = Path(tmp) / "mini.sqlite"
            write_mini_epub(epub_path)
            build_database(epub_path, db_path, "mini", chunk_size=12, overlap=2)

            located = locate_progress(db_path, "mini", "The hidden door stayed closed.")
            context = retrieve_context(db_path, "mini", located["offset"], "Who is the masked visitor?")

            self.assertGreater(len(context["chunks"]), 0)
            self.assertTrue(
                all(chunk["end_offset"] <= located["offset"] for chunk in context["chunks"]),
                json.dumps(context["chunks"], indent=2),
            )
            future_text = "queen in disguise"
            self.assertNotIn(future_text, " ".join(chunk["text"] for chunk in context["chunks"]).lower())

    def test_database_contains_fts_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            epub_path = Path(tmp) / "mini.epub"
            db_path = Path(tmp) / "mini.sqlite"
            write_mini_epub(epub_path)
            build_database(epub_path, db_path, "mini")

            with sqlite3.connect(db_path) as conn:
                count = conn.execute(
                    "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH ?",
                    ("masked",),
                ).fetchone()[0]

            self.assertGreater(count, 0)

    def test_export_corpus_writes_deployable_json_without_sqlite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            epub_path = Path(tmp) / "mini.epub"
            db_path = Path(tmp) / "mini.sqlite"
            output_path = Path(tmp) / "corpus.json"
            write_mini_epub(epub_path)
            build_database(epub_path, db_path, "mini", chunk_size=12, overlap=2)

            result = export_corpus(db_path, output_path)
            data = json.loads(output_path.read_text())

            self.assertEqual(result["books"], 1)
            self.assertEqual(data["books"][0]["id"], "mini")
            self.assertGreater(len(data["chapters"]), 0)
            self.assertGreater(len(data["chunks"]), 0)
            self.assertIn("masked visitor", data["chunks"][0]["text"].lower())


if __name__ == "__main__":
    unittest.main()
