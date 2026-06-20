import { NextRequest, NextResponse } from "next/server";
import { defaultBookId, getDemoSnippet } from "@/lib/pythonPipeline";
import type { DemoStage } from "@/lib/jsonCorpus";

const demoStages = new Set<DemoStage>(["sorting-before", "sorting-after", "snape-before", "snape-after", "early", "late"]);

export async function GET(request: NextRequest) {
  const requestedStage = request.nextUrl.searchParams.get("stage") || "sorting-before";
  const stage = demoStages.has(requestedStage as DemoStage) ? (requestedStage as DemoStage) : "sorting-before";
  const bookId = request.nextUrl.searchParams.get("bookId") || defaultBookId;
  try {
    return NextResponse.json(await getDemoSnippet(bookId, stage));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
