# Backlog

## Demo Hardening

- Add a first-class local EPUB upload/import flow from the web UI.
- Add a corpus rebuild button or CLI wrapper for ingesting a whole Calibre folder.
- Show clearer progress when OCR/model calls are running.
- Add a small cache management view for answer-cache hits and invalidation.

## Retrieval Quality

- Add entity-aware retrieval for characters, places, and objects.
- Generate spoiler-safe rolling chapter summaries during ingest.
- Improve printed chapter detection so front matter never confuses chapter numbering.
- Add tests for multi-book corpora and EPUBs with heavy front matter.

## OCR

- Add a browser/native OCR fallback for screenshots when vision APIs refuse or timeout.
- Keep OCR anchor-based rather than full-page transcription.
- Add image-crop guidance for Kindle/book screenshots.

## Product Scope

- Mobile camera capture.
- Public-domain sample corpus for hosted demos.
- Study mode for textbooks, certification prep, and class notes.
- User-owned library search across many EPUBs.

## Deployment

- Keep copyrighted EPUBs and generated corpora out of git and hosted deployments.
- Ship a public-domain demo corpus for public URLs.
- Add a documented local-only mode for private libraries.
