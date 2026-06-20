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
