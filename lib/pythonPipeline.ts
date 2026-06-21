import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import {
  type DemoStage,
  getJsonContext,
  getJsonDemoSnippet,
  hasJsonCorpus,
  listJsonBooks,
  locateJsonProgress,
} from "./jsonCorpus";

const execFileAsync = promisify(execFile);

const pythonPath = process.env.PYTHON_BIN || ".conda/bin/python";
const pipelineScript = "scripts/epub_pipeline.py";
const dbPath = "data/generated/spoiler_gate.sqlite";
const epubPath = "local_books/demo.epub";
export const defaultBookId = "demo-book";

export type LocatedProgress = {
  book_id: string;
  chapter_number: number;
  chapter_title: string;
  offset: number;
  confidence: number;
  matched_text: string;
  method: string;
};

export type SafeContext = {
  book: { id: string; title: string; author?: string; source_label: string };
  current_chapter: { chapter_number: number; title: string; start_offset: number; end_offset: number } | null;
  offset: number;
  summaries: { chapter_number: number; title: string; summary: string; end_offset: number }[];
  chunks: { id: string; chapter_number: number; start_offset: number; end_offset: number; text: string }[];
};

export async function runPipeline<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync(pythonPath, [pipelineScript, ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 8,
  });
  return JSON.parse(stdout) as T;
}

export async function ensureDatabase() {
  if (existsSync(dbPath)) return;
  if (!existsSync(epubPath)) {
    throw new Error(`Missing ${epubPath}. Add the local EPUB before running the demo.`);
  }
  await runPipeline(["ingest", epubPath, "--db", dbPath, "--book-id", defaultBookId]);
}

export async function listBooks() {
  if (hasJsonCorpus()) return listJsonBooks();
  await ensureDatabase();
  return runPipeline<{ id: string; title: string; author?: string; source_label: string }[]>(["books", "--db", dbPath]);
}

export async function locateProgress(bookId: string, pageText: string) {
  if (hasJsonCorpus()) return locateJsonProgress(bookId, pageText);
  await ensureDatabase();
  return runPipeline<LocatedProgress>([
    "locate",
    "--db",
    dbPath,
    "--book-id",
    bookId,
    "--text",
    pageText,
  ]);
}

export async function getContext(bookId: string, offset: number, question: string) {
  if (hasJsonCorpus()) return getJsonContext(bookId, offset, question);
  await ensureDatabase();
  return runPipeline<SafeContext>([
    "context",
    "--db",
    dbPath,
    "--book-id",
    bookId,
    "--offset",
    String(offset),
    "--question",
    question,
  ]);
}

export async function getDemoSnippet(bookId: string, stage: DemoStage) {
  if (hasJsonCorpus()) return getJsonDemoSnippet(bookId, stage);
  await ensureDatabase();
  return runPipeline<{
    stage: string;
    book_id: string;
    chapter_number: number;
    start_offset: number;
    end_offset: number;
    text: string;
  }>(["snippet", "--db", dbPath, "--book-id", bookId, "--stage", stage]);
}
