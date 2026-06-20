import { NextRequest, NextResponse } from "next/server";
import { locateProgress } from "@/lib/pythonPipeline";

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.bookId || !body.pageText) {
    return NextResponse.json({ error: "bookId and pageText are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await locateProgress(body.bookId, body.pageText));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
