# Spoiler Gate

Scan a book page. Ask questions. No spoilers past where you are.

Spoiler Gate is a local-first, bring-your-own-books demo. The repo should not
include copyrighted EPUBs, generated corpora, API keys, or screenshots. Users
can ingest their own legally owned EPUBs and run the app locally.

## Local Setup

Local-only files:

- Put user-owned EPUB/text files in `local_books/`.
- Put real API keys in `.env.local`.
- Do not commit either.

The app should read variable names from `.env.example`, not from real env files during planning/review.

Install Node dependencies:

```bash
npm install
cp .env.example .env.local
```

Recommended Python setup with a project-local Conda environment:

```bash
conda env create -p ./.conda -f environment.yml
conda activate ./.conda
```

Alternative Python setup with `venv`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If you use `venv` instead of Conda, set this in `.env.local`:

```text
PYTHON_BIN=.venv/bin/python
```

Start the app:

```bash
npm run dev
```

Add your own API keys to `.env.local` if you want live model answers or screenshot OCR.
Pasted page text works without OCR.

## Demo Data

Build the local demo DB and optional JSON corpus artifact:

```bash
npm run prepare:local-demo
```

The JSON artifact is written to `data/generated/demo-corpus.json`. It is ignored because it may contain text derived from a user-owned EPUB.

Local API routes prefer `data/generated/demo-corpus.json` when it exists, then fall back to the Python/SQLite pipeline.

For public deployment, use a public-domain corpus or an explicitly approved demo artifact. Do not deploy private EPUB files or real secrets.

To ingest multiple local EPUBs into one local corpus:

```bash
.conda/bin/python scripts/epub_pipeline.py ingest-many "/path/to/book-1.epub" "/path/to/book-2.epub" --db data/generated/spoiler_gate.sqlite
.conda/bin/python scripts/epub_pipeline.py export --db data/generated/spoiler_gate.sqlite --output data/generated/demo-corpus.json
```

## What Is Reliable

- EPUB ingest reads the EPUB spine order, extracts HTML text, chunks by word count, and tracks character offsets.
- Storage uses simple SQLite tables plus an FTS index, with a JSON corpus export for a faster local/demo path.
- Spoiler safety is enforced at retrieval time: safe chunks must end at or before the reader's current offset.
- The UI shows the boundary proof, including `0 future chunks`, so the safety claim is inspectable.
- Repeated questions can be served from a local SQLite answer cache keyed by book, offset, question, answer mode, and context signature.

## Architecture

```text
User-owned EPUBs
  -> Python EPUB ingest
  -> SQLite books/chapters/chunks + FTS
  -> optional JSON corpus export
  -> pasted text or OCR anchor phrases
  -> substring locator returns current offset
  -> bounded retrieval: chunks end_offset <= current_offset
  -> model answer + verifier
  -> local answer cache for repeat questions
```

The model is never used as the source of truth for book progress. It only sees
the retrieved safe context.

## OCR Reality

Screenshot OCR is optional. The reliable fallback is pasting 1-2 visible lines
from the page.

For OCR, set:

```text
OCR_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=...
```

The OCR route intentionally asks the vision model for short exact anchor phrases,
not a full page transcription. This is important because vision models may refuse
or summarize copyrighted page images when asked to reproduce the full text. Short
anchors are enough for Spoiler Gate: the app only needs to locate the page inside
the user's local corpus, then all answering uses the local EPUB text.

## Caveats

- OCR is useful, but pasting 1-3 visible lines is more reliable.
- EPUB formatting varies. Normal HTML EPUBs work best; DRM-protected or image-only books are out of scope.
- The current locator favors exact normalized substring matches, then FTS fallback in the SQLite path.
- Answer quality depends on the retrieved context and the selected model. The core guarantee is bounded retrieval, not perfect literary analysis.
- Printed chapter numbers may differ from EPUB spine sections because many books include front matter. The UI shows both the chapter title and EPUB section.

## Demo Checklist

1. Select a locally ingested book.
2. Upload a screenshot or paste visible page text.
3. Confirm the app locates a chapter/title and offset.
4. Ask a spoiler-sensitive question.
5. Point to the boundary proof and `0 future chunks`.
6. Repeat at a later page to show the answer changes only when the reading boundary moves.
