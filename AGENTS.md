# Spoiler Gate Agent Notes

This repo is for a short hackathon demo. Optimize for a working demo, not production architecture.

## Product Scope

Build a corpus-backed spoiler-safe book companion:

```text
owned corpus -> OCR/pasted text anchor -> progress offset -> bounded retrieval -> safe answer
```

The LLM must not be treated as the source of truth for chapter pacing or future plot knowledge.

## Implementation Priorities

1. Make a working local demo.
2. Keep retrieval bounded by `end_offset <= current_offset`.
3. Show a context inspector so the safety boundary is visible.
4. Use hardcoded fixtures when they improve demo reliability.
5. Treat OCR, upload, education mode, and gamification as optional.

## Parallel Work

Use worktrees for independent feature branches:

- corpus + SQLite ingest/retrieval
- UI shell
- LLM answer and verifier pipeline

Use subagents for narrow, independent tasks. Avoid parallel edits to the same files.

Direct pushes to `main` are acceptable for small setup, docs, and low-risk hackathon changes. Use branches or worktrees only when the task is independent enough to benefit from isolation.

Every commit created by Codex must include this trailer:

```text
Co-authored-by: Codex <codex@openai.com>
```

## Secrets

Do not read `.env`, `.env.local`, or any real secret file.

Only read or edit `.env.example`. Keep real API keys out of git.

Expected key stubs live in `.env.example`.

## Verification

Before claiming a feature works, run the smallest relevant command:

- locator: verify a known snippet maps to the expected chapter/offset
- retrieval: verify no returned chunk exceeds `current_offset`
- UI: run the app and test the happy-path demo

If the exact test command is not available yet, add a small script or document the manual check used.
