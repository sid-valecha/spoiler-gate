import { NextResponse } from "next/server";
import { listBooks } from "@/lib/pythonPipeline";

export async function GET() {
  try {
    return NextResponse.json({ books: await listBooks() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
