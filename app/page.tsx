"use client";

import { useEffect, useMemo, useState } from "react";

type Book = { id: string; title: string; author?: string; source_label: string };
type Located = {
  book_id: string;
  chapter_number: number;
  chapter_title: string;
  offset: number;
  confidence: number;
  matched_text: string;
  method: string;
};
type Chunk = { id: string; chapter_number: number; start_offset: number; end_offset: number; text: string };
type Answer = {
  answer: string;
  provider: string;
  model: string;
  verified: boolean;
  fallback: boolean;
  cacheHit?: boolean;
  cacheHits?: number;
  boundaryProof: {
    offset: number;
    chunks: number;
    maxChunkEnd: number;
    futureChunks: number;
  };
  context: {
    chunks: Chunk[];
    current_chapter: { chapter_number: number; title: string } | null;
  };
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [books, setBooks] = useState<Book[]>([]);
  const [bookId, setBookId] = useState("harry-potter-sorcerers-stone");
  const [pageText, setPageText] = useState("");
  const [located, setLocated] = useState<Located | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [fastDemo, setFastDemo] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [books, bookId]);

  useEffect(() => {
    fetch("/api/books")
      .then((response) => response.json())
      .then((data) => {
        if (data.books?.length) {
          setBooks(data.books);
          setBookId(data.books[0].id);
        } else if (data.error) {
          setError(data.error);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  async function locate() {
    setBusy("Locating page");
    setError("");
    setAnswer(null);
    try {
      setLocated(await postJson<Located>("/api/locate", { bookId, pageText }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("");
    }
  }

  async function ocrImage(file: File | null) {
    if (!file) return;
    setBusy("Reading screenshot");
    setError("");
    setAnswer(null);
    try {
      const imageData = await readFileAsDataUrl(file);
      const result = await postJson<{ text: string; anchors?: string[] }>("/api/ocr", { imageData });
      setPageText(result.text);
      const locatedResult = await postJson<Located>("/api/locate", { bookId, pageText: result.text });
      setLocated(locatedResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown OCR error");
    } finally {
      setBusy("");
    }
  }

  async function ask() {
    if (!located) {
      setError("Locate your page before asking.");
      return;
    }
    setBusy("Answering");
    setError("");
    try {
      setAnswer(await postJson<Answer>("/api/ask", { bookId, offset: located.offset, question, fastDemo }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Spoiler Gate</h1>
          <p>Ask from the page you are on. Nothing past the source boundary.</p>
        </div>
        <div className="statusPill">Status: {busy || "Ready"}</div>
      </header>

      <section className="grid">
        <div className="panel">
          <div className="sectionHeader">
            <h2>1. Set the reading boundary</h2>
            <span>EPUB-backed</span>
          </div>

          <label className="fieldLabel" htmlFor="book">
            Book
          </label>
          <select id="book" value={bookId} onChange={(event) => setBookId(event.target.value)}>
            {books.map((book) => (
              <option value={book.id} key={book.id}>
                {book.title}
              </option>
            ))}
          </select>
          {selectedBook ? <p className="muted">{selectedBook.source_label}</p> : null}

          <label className="uploadBox">
            <span>Upload page screenshot</span>
            <small>OCR reads short anchor phrases, then locates them in the EPUB.</small>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void ocrImage(event.target.files?.[0] || null)}
              disabled={Boolean(busy)}
            />
          </label>

          <label className="fieldLabel" htmlFor="pageText">
            Page text or OCR anchors
          </label>
          <textarea
            id="pageText"
            value={pageText}
            onChange={(event) => setPageText(event.target.value)}
            placeholder="Paste 1-2 visible lines, upload a screenshot, or use a demo page."
          />

          <button className="primary" type="button" onClick={locate} disabled={Boolean(busy) || !pageText.trim()}>
            Locate me in the book
          </button>

          {located ? (
            <div className="resultBox">
              <strong>Located: {located.chapter_title}</strong>
              <span>
                EPUB section {located.chapter_number} · offset {located.offset.toLocaleString()} ·{" "}
                {Math.round(located.confidence * 100)}% · {located.method}
              </span>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="sectionHeader">
            <h2>2. Ask without spoilers</h2>
            <span>bounded retrieval</span>
          </div>

          <label className="fieldLabel" htmlFor="question">
            Question
          </label>
          <input
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask anything that might depend on how far you have read"
          />

          <label className="toggleRow">
            <input
              type="checkbox"
              checked={fastDemo}
              onChange={(event) => setFastDemo(event.target.checked)}
            />
            <span>Local deterministic mode</span>
            <small>Use only built-in demo rules when model calls are slow or unavailable.</small>
          </label>

          <button className="primary" type="button" onClick={ask} disabled={Boolean(busy) || !located || !question}>
            Ask from safe context
          </button>

          {error ? <div className="errorBox">{error}</div> : null}

          {answer ? (
            <div className="answerBox">
              <div className="answerMeta">
                <span>{answer.provider}</span>
                <span>{answer.cacheHit ? `cache hit${answer.cacheHits ? ` x${answer.cacheHits}` : ""}` : "fresh answer"}</span>
                <span>{answer.fallback ? "demo fallback" : answer.model}</span>
                <span>{answer.verified ? "verified" : "unchecked"}</span>
                <span>{answer.boundaryProof.futureChunks} future chunks</span>
              </div>
              <p>{answer.answer}</p>
              <div className="proofBox">
                Max chunk end {answer.boundaryProof.maxChunkEnd.toLocaleString()} {" <= "} boundary{" "}
                {answer.boundaryProof.offset.toLocaleString()}
              </div>
            </div>
          ) : (
            <div className="emptyState">Upload or paste a page, locate your reading boundary, then ask from safe context.</div>
          )}

          {answer?.context?.chunks?.length ? (
            <details className="contextBox" open>
              <summary>Safe context used ({answer.context.chunks.length} chunks)</summary>
              {answer.context.chunks.map((chunk) => (
                <article key={chunk.id}>
                  <strong>
                    EPUB section {chunk.chapter_number} · offsets {chunk.start_offset.toLocaleString()}-
                    {chunk.end_offset.toLocaleString()}
                  </strong>
                  <p>{chunk.text}</p>
                </article>
              ))}
            </details>
          ) : null}
        </div>
      </section>
    </main>
  );
}
