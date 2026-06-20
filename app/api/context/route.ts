import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/pythonPipeline";

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.bookId || typeof body.offset !== "number") {
    return NextResponse.json({ error: "bookId and numeric offset are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getContext(body.bookId, body.offset, body.question || ""));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
