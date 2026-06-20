import { existsSync, readFileSync } from "node:fs";
import type { LocatedProgress, SafeContext } from "./pythonPipeline";

export const corpusPath = "data/generated/demo-corpus.json";

type Book = { id: string; title: string; author?: string; source_label: string };
type Chapter = {
  id: string;
  book_id: string;
  chapter_number: number;
  title: string;
  start_offset: number;
  end_offset: number;
  summary: string;
  text: string;
};
type Chunk = {
  id: string;
  book_id: string;
  chapter_number: number;
  start_offset: number;
  end_offset: number;
  text: string;
};
type Corpus = { schema_version: number; books: Book[]; chapters: Chapter[]; chunks: Chunk[] };

let cachedCorpus: Corpus | null = null;

export function hasJsonCorpus() {
  return existsSync(corpusPath);
}

function loadCorpus(): Corpus {
  if (!cachedCorpus) {
    cachedCorpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;
  }
  return cachedCorpus;
}

function normalizeText(text: string) {
  return text
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeWithMap(text: string) {
  let normalized = "";
  const map: number[] = [];
  let lastSpace = true;
  Array.from(text).forEach((char, index) => {
    const value = /[A-Za-z0-9]/.test(char) ? char.toLowerCase() : " ";
    if (value === " ") {
      if (!lastSpace) {
        normalized += " ";
        map.push(index);
      }
      lastSpace = true;
      return;
    }
    normalized += value;
    map.push(index);
    lastSpace = false;
  });
  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { normalized, map };
}

function candidatePhrases(pageText: string) {
  const words = normalizeText(pageText).split(" ").filter(Boolean);
  const phrases: string[] = [];
  for (const size of [20, 16, 12, 8, 5]) {
    if (words.length >= size) {
      const midpoint = Math.max(0, Math.floor((words.length - size) / 2));
      phrases.push(words.slice(midpoint, midpoint + size).join(" "));
      phrases.push(words.slice(0, size).join(" "));
      phrases.push(words.slice(-size).join(" "));
    }
  }
  return [...new Set(phrases.filter(Boolean))];
}

function chaptersFor(bookId: string) {
  return loadCorpus()
    .chapters.filter((chapter) => chapter.book_id === bookId)
    .sort((a, b) => a.chapter_number - b.chapter_number);
}

function fullBookText(bookId: string) {
  const chapters = chaptersFor(bookId);
  if (!chapters.length) throw new Error(`Book not found: ${bookId}`);
  const parts: string[] = [];
  for (const chapter of chapters) {
    const currentLength = parts.reduce((sum, part) => sum + part.length, 0);
    const gap = chapter.start_offset - currentLength;
    if (gap > 0) parts.push(" ".repeat(gap));
    parts.push(chapter.text);
  }
  return { text: parts.join(""), chapters };
}

export function listJsonBooks() {
  return loadCorpus().books;
}

export function locateJsonProgress(bookId: string, pageText: string): LocatedProgress {
  if (normalizeText(pageText).split(" ").length < 5) {
    throw new Error("Need at least five readable words to locate progress");
  }
  const { text, chapters } = fullBookText(bookId);
  const { normalized, map } = normalizeWithMap(text);
  const ranges: { start: number; end: number; phrase: string }[] = [];
  for (const phrase of candidatePhrases(pageText)) {
    const index = normalized.indexOf(phrase);
    if (index >= 0) ranges.push({ start: index, end: Math.min(map.length - 1, index + phrase.length - 1), phrase });
  }
  if (!ranges.length) throw new Error("Could not locate page text in selected book");

  const firstIndex = Math.min(...ranges.map((range) => range.start));
  const lastIndex = Math.max(...ranges.map((range) => range.end));
  const originalOffset = map[firstIndex];
  const boundaryOffset = Math.min(text.length, map[lastIndex] + 1);
  const chapter = chapters.find((item) => item.start_offset <= boundaryOffset && item.end_offset >= boundaryOffset);
  if (!chapter) throw new Error("Located text outside chapter range");
  const longestPhrase = ranges.map((range) => range.phrase).sort((a, b) => b.split(" ").length - a.split(" ").length)[0];

  return {
    book_id: bookId,
    chapter_number: chapter.chapter_number,
    chapter_title: chapter.title,
    offset: boundaryOffset,
    confidence: Math.min(0.98, 0.55 + longestPhrase.split(" ").length / 40 + ranges.length / 20),
    matched_text: text.slice(originalOffset, originalOffset + 260),
    method: "json-substring",
  };
}

export function getJsonContext(bookId: string, offset: number, question: string): SafeContext {
  const corpus = loadCorpus();
  const book = corpus.books.find((item) => item.id === bookId);
  if (!book) throw new Error(`Book not found: ${bookId}`);
  const chapters = corpus.chapters.filter((chapter) => chapter.book_id === bookId);
  const current = chapters.find((chapter) => chapter.start_offset <= offset && chapter.end_offset >= offset) || null;
  const terms = normalizeText(question)
    .split(" ")
    .filter((word) => word.length > 3)
    .slice(0, 8);
  const scoredChunks = corpus.chunks
    .filter((chunk) => chunk.book_id === bookId && chunk.end_offset <= offset)
    .map((chunk) => ({
      chunk,
      score: terms.reduce((score, term) => score + (normalizeText(chunk.text).includes(term) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || b.chunk.end_offset - a.chunk.end_offset)
    .slice(0, 5)
    .map(({ chunk }) => chunk);
  const nearbyChunks = corpus.chunks
    .filter((chunk) => chunk.book_id === bookId && chunk.end_offset <= offset)
    .sort((a, b) => b.end_offset - a.end_offset)
    .slice(0, 5);
  const seen = new Set<string>();
  const safeChunks = [...scoredChunks, ...nearbyChunks]
    .filter((chunk) => {
      if (seen.has(chunk.id)) return false;
      seen.add(chunk.id);
      return true;
    })
    .sort((a, b) => b.end_offset - a.end_offset)
    .slice(0, 8)
    .map((chunk) => ({
      id: chunk.id,
      chapter_number: chunk.chapter_number,
      start_offset: chunk.start_offset,
      end_offset: chunk.end_offset,
      text: chunk.text,
    }));

  return {
    book,
    current_chapter: current,
    offset,
    summaries: chapters
      .filter((chapter) => chapter.end_offset <= offset)
      .map((chapter) => ({
        chapter_number: chapter.chapter_number,
        title: chapter.title,
        summary: chapter.summary,
        end_offset: chapter.end_offset,
      })),
    chunks: safeChunks,
  };
}

export function getJsonDemoSnippet(bookId: string, stage: "early" | "late") {
  const normalizedStage = stage === "late" ? "late" : "early";
  const chunks = loadCorpus().chunks.filter((chunk) => chunk.book_id === bookId);
  const chosen =
    normalizedStage === "early"
      ? chunks.find((chunk) => chunk.chapter_number >= 13 && chunk.chapter_number <= 15 && /Snape/i.test(chunk.text))
      : chunks.find(
          (chunk) =>
            chunk.chapter_number === 22 &&
            /Quirrell/i.test(chunk.text) &&
            /Snape/i.test(chunk.text) &&
            (/trying to save/i.test(chunk.text) || /never wanted/i.test(chunk.text)),
        );
  const chunk = chosen || chunks[0];
  if (!chunk) throw new Error(`No chunks found for ${bookId}`);
  return {
    stage: normalizedStage,
    book_id: bookId,
    chapter_number: chunk.chapter_number,
    start_offset: chunk.start_offset,
    end_offset: chunk.end_offset,
    text: chunk.text,
  };
}
