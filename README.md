# spoiler-gate
Scan a book page. Ask questions. No spoilers past where you are

## Local Setup

Use the project-local Conda environment:

```bash
conda activate /Users/sidvalecha/Developer/spoiler-gate/.conda
```

Local-only files:

- Put user-owned EPUB/text files in `local_books/`.
- Put real API keys in `.env.local`.
- Do not commit either.

The app should read variable names from `.env.example`, not from real env files during planning/review.

## Demo Data

Build the local demo DB and optional JSON corpus artifact:

```bash
npm run prepare:local-demo
```

The JSON artifact is written to `data/generated/demo-corpus.json`. It is ignored because it may contain text derived from a user-owned EPUB.

Local API routes prefer `data/generated/demo-corpus.json` when it exists, then fall back to the Python/SQLite pipeline.

For public deployment, use a public-domain corpus or an explicitly approved demo artifact. Do not deploy private EPUB files or real secrets.
