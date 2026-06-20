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
  context: {
    chunks: Chunk[];
    current_chapter: { chapter_number: number; title: string } | null;
  };
};

const defaultQuestion = "Is Snape evil?";

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

export default function Home() {
  const [books, setBooks] = useState<Book[]>([]);
  const [bookId, setBookId] = useState("harry-potter-sorcerers-stone");
  const [pageText, setPageText] = useState("");
  const [located, setLocated] = useState<Located | null>(null);
  const [question, setQuestion] = useState(defaultQuestion);
  const [answer, setAnswer] = useState<Answer | null>(null);
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

  async function loadSnippet(stage: "early" | "late") {
    setBusy(`Loading ${stage} page`);
    setError("");
    setAnswer(null);
    try {
      const response = await fetch(`/api/demo-snippet?bookId=${bookId}&stage=${stage}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load demo snippet");
      setPageText(data.text);
      const result = await postJson<Located>("/api/locate", { bookId, pageText: data.text });
      setLocated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("");
    }
  }

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

  async function ask() {
    if (!located) {
      setError("Locate your page before asking.");
      return;
    }
    setBusy("Answering");
    setError("");
    try {
      setAnswer(await postJson<Answer>("/api/ask", { bookId, offset: located.offset, question }));
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
        <div className="statusPill">{busy || "Ready"}</div>
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

          <div className="buttonRow">
            <button type="button" onClick={() => loadSnippet("early")} disabled={Boolean(busy)}>
              Use early demo page
            </button>
            <button type="button" onClick={() => loadSnippet("late")} disabled={Boolean(busy)}>
              Use later demo page
            </button>
          </div>

          <label className="fieldLabel" htmlFor="pageText">
            Page text
          </label>
          <textarea
            id="pageText"
            value={pageText}
            onChange={(event) => setPageText(event.target.value)}
            placeholder="Paste text from the page, or use a demo page."
          />

          <button className="primary" type="button" onClick={locate} disabled={Boolean(busy) || !pageText.trim()}>
            Locate me in the book
          </button>

          {located ? (
            <div className="resultBox">
              <strong>Located: Chapter {located.chapter_number}</strong>
              <span>{located.chapter_title}</span>
              <span>
                Offset {located.offset.toLocaleString()} · {Math.round(located.confidence * 100)}% · {located.method}
              </span>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="sectionHeader">
            <h2>2. Ask without spoilers</h2>
            <span>bounded retrieval</span>
          </div>

          <button className="questionChip" type="button" onClick={() => setQuestion(defaultQuestion)}>
            {defaultQuestion}
          </button>

          <label className="fieldLabel" htmlFor="question">
            Question
          </label>
          <input
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a spoiler-risky question"
          />

          <button className="primary" type="button" onClick={ask} disabled={Boolean(busy) || !located || !question}>
            Ask from safe context
          </button>

          {error ? <div className="errorBox">{error}</div> : null}

          {answer ? (
            <div className="answerBox">
              <div className="answerMeta">
                <span>{answer.provider}</span>
                <span>{answer.fallback ? "demo fallback" : answer.model}</span>
                <span>{answer.verified ? "verified" : "unchecked"}</span>
              </div>
              <p>{answer.answer}</p>
            </div>
          ) : (
            <div className="emptyState">Load a demo page, locate it, then ask the same question early and later.</div>
          )}

          {answer?.context?.chunks?.length ? (
            <details className="contextBox" open>
              <summary>Safe context used ({answer.context.chunks.length} chunks)</summary>
              {answer.context.chunks.map((chunk) => (
                <article key={chunk.id}>
                  <strong>
                    Chapter {chunk.chapter_number} · offsets {chunk.start_offset.toLocaleString()}-
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
