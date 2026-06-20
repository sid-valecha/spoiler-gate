import { NextRequest, NextResponse } from "next/server";
import { defaultBookId, getDemoSnippet } from "@/lib/pythonPipeline";

export async function GET(request: NextRequest) {
  const stage = request.nextUrl.searchParams.get("stage") === "late" ? "late" : "early";
  const bookId = request.nextUrl.searchParams.get("bookId") || defaultBookId;
  try {
    return NextResponse.json(await getDemoSnippet(bookId, stage));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
