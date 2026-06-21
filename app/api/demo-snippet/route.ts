import { NextRequest, NextResponse } from "next/server";
import { defaultBookId, getDemoSnippet } from "@/lib/pythonPipeline";
import type { DemoStage } from "@/lib/jsonCorpus";

const demoStages = new Set<DemoStage>(["early", "late"]);

export async function GET(request: NextRequest) {
  const requestedStage = request.nextUrl.searchParams.get("stage") || "early";
  const stage = demoStages.has(requestedStage as DemoStage) ? (requestedStage as DemoStage) : "early";
  const bookId = request.nextUrl.searchParams.get("bookId") || defaultBookId;
  try {
    return NextResponse.json(await getDemoSnippet(bookId, stage));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
