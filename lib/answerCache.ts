import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AnswerResult } from "./llm";
import type { SafeContext } from "./pythonPipeline";

const execFileAsync = promisify(execFile);
const pythonPath = ".conda/bin/python";
const cacheScript = "scripts/answer_cache.py";

export type CachedAnswerResult = AnswerResult & {
  cacheHit?: boolean;
  cacheHits?: number;
};

function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function answerCacheKey(question: string, context: SafeContext, fastDemo: boolean) {
  const contextSignature = context.chunks
    .map((chunk) => `${chunk.id}:${chunk.start_offset}:${chunk.end_offset}`)
    .join("|");
  return createHash("sha256")
    .update(
      JSON.stringify({
        bookId: context.book.id,
        offset: context.offset,
        question: normalizeQuestion(question),
        fastDemo,
        contextSignature,
      }),
    )
    .digest("hex");
}

async function runCache<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync(pythonPath, [cacheScript, ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

export async function getCachedAnswer(cacheKey: string): Promise<CachedAnswerResult | null> {
  try {
    return await runCache<CachedAnswerResult | null>(["get", "--key", cacheKey]);
  } catch {
    return null;
  }
}

export async function putCachedAnswer(
  cacheKey: string,
  payload: { bookId: string; offset: number; question: string; answer: AnswerResult },
) {
  try {
    await runCache(["put", "--key", cacheKey, "--payload", JSON.stringify(payload)]);
  } catch {
    // Cache failures should never break answering.
  }
}
