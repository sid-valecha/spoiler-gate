import { NextRequest, NextResponse } from "next/server";
import { answerCacheKey, getCachedAnswer, putCachedAnswer } from "@/lib/answerCache";
import { answerQuestion } from "@/lib/llm";
import { getContext } from "@/lib/pythonPipeline";

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.bookId || typeof body.offset !== "number" || !body.question) {
    return NextResponse.json({ error: "bookId, offset, and question are required" }, { status: 400 });
  }
  try {
    const context = await getContext(body.bookId, body.offset, body.question);
    const fastDemo = Boolean(body.fastDemo);
    const cacheKey = answerCacheKey(body.question, context, fastDemo);
    const cachedAnswer = await getCachedAnswer(cacheKey);
    const answer = cachedAnswer || (await answerQuestion(body.question, context, { fastDemo }));
    if (!cachedAnswer) {
      await putCachedAnswer(cacheKey, {
        bookId: body.bookId,
        offset: body.offset,
        question: body.question,
        answer,
      });
    }
    const maxChunkEnd = Math.max(0, ...context.chunks.map((chunk) => chunk.end_offset));
    return NextResponse.json({
      ...answer,
      cacheHit: Boolean(cachedAnswer),
      context,
      boundaryProof: {
        offset: body.offset,
        chunks: context.chunks.length,
        maxChunkEnd,
        futureChunks: context.chunks.filter((chunk) => chunk.end_offset > body.offset).length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
