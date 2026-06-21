# Spoiler Gate Hackathon Roadmap

Goal: build a corpus-backed reading companion that finds where you are in a book, then answers questions using only text before that point.

Time budget: 2 hours. Demo quality beats production completeness.

## Locked Idea

Build **Spoiler Gate**, a spoiler-safe book companion.

Demo line:

> Pick a book, scan or paste text from your current page, and ask questions. The app searches the actual book text to locate your progress, retrieves only earlier context, and refuses spoilers past that point.

This is stronger than relying on an LLM's memory of the plot. The technical story is:

```text
owned corpus -> OCR text anchor -> progress position -> bounded retrieval -> spoiler-safe answer
```

## Demo Scope

Build for books only.

Seed the demo with:

- Public-domain text: `The Adventures of Sherlock Holmes`
- Optional second public-domain text: `Alice's Adventures in Wonderland`
- "Owned upload" demo slot: a user-provided local EPUB for personal use

Do not position copyrighted text as bundled app data. For the demo, you can say: "This path works for user-owned EPUB/text uploads."

## Recommended Architecture

Use a tiny local database. This gives you real technical chops without overbuilding.

```text
Book text files
  -> ingest script
  -> SQLite tables + FTS index
  -> OCR/pasted page text
  -> substring/fuzzy anchor search
  -> current character offset + chapter
  -> retrieve snippets before offset
  -> LLM answer from bounded snippets
  -> spoiler verifier checks no future context leaked
```

## Stack

Recommended:

- Next.js App Router for UI and API routes
- SQLite for `books`, `chapters`, `chunks`, and FTS
- `better-sqlite3` for local/demo speed
- JSON/in-memory fallback if deployment gets annoying
- Groq-first LLM provider for fast demo responses
- OpenAI or Anthropic fallback if Groq hits a rate limit, outage, or quality issue
- OCR optional:
  - Fast path: paste text from page or upload a screenshot
  - Optional: browser OCR with Tesseract.js
  - Optional: vision model OCR if credits are easy
- One LLM provider for answer + verifier

Avoid:

- vector DB
- EPUB parser unless time remains
- account system
- polished upload pipeline
- full education/gamification product

## Database Shape

Keep schema small:

```sql
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
  summary TEXT NOT NULL
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='rowid'
);
```

For a hackathon, the schema can be simplified if needed. The must-have fields are `book_id`, `chapter_number`, `start_offset`, `end_offset`, and `text`.

## Core Flow

### 1. Select Book

UI:

- Search/select book.
- Show source label:
  - `Public domain demo text`
  - `User-owned upload demo`

### 2. Locate Progress

Input options:

- MVP: paste a paragraph from the page.
- Better: upload/take image, OCR it, then search.

Locator logic:

```text
normalize OCR text
take 8-20 word distinctive phrases
search exact substring in full book text
if exact match fails, use FTS search
return best match offset + chapter
```

This is the best technical feature to show live.

### 3. Retrieve Safe Context

Given `current_offset`, retrieve:

- chapter summaries where `end_offset <= current_offset`
- top matching chunks where `end_offset <= current_offset`
- nearby chunks before the current offset

Never retrieve chunks after `current_offset`.

### 4. Answer

Prompt the model with only safe context:

```text
You are answering questions for a reader.
They have read up to offset X in BOOK.
Use only the provided excerpts and summaries.
If the answer is not supported by the context, say it has not been revealed yet.
Do not use outside knowledge.
```

### 5. Verify

Run a second model call:

```text
Given the safe context and answer, did the answer introduce any claim not supported by the context?
Return CLEAN or UNSUPPORTED.
```

This avoids needing the verifier to know the whole future plot.

## Provider Strategy

Use a provider wrapper so the app can fail over without changing API routes:

```text
try Groq
if rate-limited/error -> try OpenAI
if rate-limited/error -> try Anthropic
if all fail -> return a polished demo fallback answer
```

Recommended env names:

```text
GROQ_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
PRIMARY_LLM_PROVIDER=groq
GROQ_MODEL=openai/gpt-oss-120b
OPENAI_MODEL=<set from your OpenAI account>
ANTHROPIC_MODEL=<set from your Anthropic account>
```

Groq is the default for demo speed. Use OpenAI/Anthropic as backup for answer quality or if Groq limits show up.

Do not read or commit real `.env` files. Commit only `.env.example`.

## Hardcoded Demo Is Allowed

Hardcode where it helps:

- Use two preloaded books.
- Precompute chapter summaries manually or with a one-time script.
- Include a familiar-book demo row only if you have local owned text.
- Add sample page snippets as buttons:
  - `Use early page`
  - `Use later page`

The demo should still route through the real locator/retrieval code.

## Two-Hour Build Plan

### 0:00-0:15 - Project + Data Setup

- Create Next.js app.
- Add `better-sqlite3`.
- Add `data/books/sherlock.txt`.
- Add ingest script that:
  - reads text
  - splits chapters
  - chunks text
  - writes SQLite rows
- Keep a JSON fallback path if native SQLite dependency setup burns time.

Success check:

```text
sqlite db contains one book, chapters, and chunks.
```

### 0:15-0:40 - Progress Locator

- Build `/api/locate`.
- Input: `{ bookId, pageText }`.
- Normalize text.
- Search distinctive phrases as substrings.
- Fallback to FTS.
- Return `{ chapterNumber, offset, confidence, matchedText }`.

Success check:

```text
Pasting a paragraph from Sherlock returns the right chapter.
```

### 0:40-1:05 - Bounded Retrieval

- Build `/api/context`.
- Input: `{ bookId, offset, question }`.
- Return:
  - previous chapter summaries
  - top chunks before offset
  - nearby pre-offset chunks

Success check:

```text
No returned chunk has end_offset > current_offset.
```

### 1:05-1:30 - Spoiler-Safe Q&A

- Build `/api/ask`.
- Input: `{ bookId, offset, question }`.
- Retrieve safe context.
- Ask model to answer only from context.
- Add unsupported-claim verifier.

Success check:

```text
Questions about later plot points get "not revealed yet" style answers.
```

### 1:30-1:50 - UI

- One mobile-ish page:
  - book search/select
  - paste page text box
  - "Locate me" button
  - progress badge
  - question input
  - answer card
  - context inspector showing safe chunks

Success check:

```text
You can demo the whole flow without touching the terminal.
```

### 1:50-2:00 - Demo Hardening

- Add sample snippet buttons.
- Add fallback hardcoded answer if LLM fails.
- Test exact script twice.

Success check:

```text
The demo works even if OCR or the model is slow.
```

## Optional Add-Ons

### If 30 Minutes Remain: OCR

Add image upload and OCR:

- easiest: model vision OCR
- cooler local angle: Tesseract.js

Return OCR text into the same `/api/locate` flow.

### If 20 Minutes Remain: Upload Text

Let user paste/upload a `.txt` file and ingest it into memory or SQLite.

For the demo, this can be fake-polished:

- upload form
- parse text
- store as one new `book`
- split into chunks

### If 15 Minutes Remain: Memory Card

Show a "Reader Memory" panel:

- known characters
- known places
- open questions
- events so far

This can be generated from safe chapter summaries, not from future text.

## Demo Script

1. "This is spoiler-safe RAG for books."
2. Select `The Adventures of Sherlock Holmes`.
3. Paste or click an early page snippet.
4. App locates current chapter and offset in the actual book text.
5. Ask a question that needs future context.
6. Answer says it is not supported/revealed yet.
7. Click a later snippet.
8. Ask the same question again.
9. Answer changes because more source text is now inside the safe boundary.
10. Open context inspector and show that every retrieved chunk is before the current offset.

## Pitch Future Scope

Only mention these:

- EPUB upload for personal libraries
- study mode for textbooks and cert prep
- quiz generation from only covered material
- progress-aware memory/gamification
- TV episode support

## Final Recommendation

Build the DB-backed text locator and bounded retrieval first.

Camera OCR is not the core product. The core product is proving that every answer is grounded in source text before the reader's current position.

## Repo Rules

- Direct pushes to `main` are fine for small hackathon changes.
- Use branches/worktrees only when isolation actually helps.
- Every Codex commit should include:

```text
Co-authored-by: Codex <codex@openai.com>
```

- Never commit `.env`, `.env.local`, EPUBs, or copyrighted source text.
- Use `.env.example` for variable names only.

## Parallel Build Strategy

Use worktrees for larger independent branches. Use subagents for quick read-heavy or narrow implementation tasks.

Recommended split:

1. **Main/local thread: integration owner**
   - Keep product scope, demo script, and final app coherence here.
   - Merge or cherry-pick worktree results.
   - Run final demo verification.

2. **Worktree A: corpus + SQLite**
   - Ingest public-domain text.
   - Build schema, chunking, offsets, FTS.
   - Expose locator/retrieval helpers.

3. **Worktree B: UI shell**
   - Build mobile-first single-page app.
   - Add book selector, page text input, context inspector, answer card.
   - Use mocked API responses until backend is ready.

4. **Worktree C: LLM answer pipeline**
   - Build prompts and `/api/ask`.
   - Add unsupported-claim verifier.
   - Keep provider wrapper isolated.

Use Codex Spark for fast, simple tasks:

- generating UI scaffolds
- writing seed data fixtures
- writing small helpers
- creating sample snippets
- turning notes into concise docs

Do not use Spark as the final reviewer for retrieval correctness, offset boundaries, or spoiler-safety logic. Use a stronger model there.

## Book Metadata APIs

Use a book API only for search/autocomplete metadata. Do not depend on an external API for the actual text boundary.

Best option:

- **Open Library Search API** for title/author/cover metadata.

Good public-domain option:

- **Gutendex** for Project Gutenberg metadata and text download URLs.

Probably not needed for MVP:

- **Google Books API**, unless you want broader commercial-book metadata.

MVP rule:

```text
Book API can help the user find a title.
The spoiler boundary must come from our ingested text, not remote metadata.
```
