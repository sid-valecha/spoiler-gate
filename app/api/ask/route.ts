import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/llm";
import { getContext } from "@/lib/pythonPipeline";

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.bookId || typeof body.offset !== "number" || !body.question) {
    return NextResponse.json({ error: "bookId, offset, and question are required" }, { status: 400 });
  }
  try {
    const context = await getContext(body.bookId, body.offset, body.question);
    const answer = await answerQuestion(body.question, context, { fastDemo: Boolean(body.fastDemo) });
    const maxChunkEnd = Math.max(0, ...context.chunks.map((chunk) => chunk.end_offset));
    return NextResponse.json({
      ...answer,
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
