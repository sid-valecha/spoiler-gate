import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.imageData || typeof body.imageData !== "string") {
    return NextResponse.json({ error: "imageData is required" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL) {
    return NextResponse.json({ error: "Anthropic OCR is not configured" }, { status: 500 });
  }

  const match = body.imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return NextResponse.json({ error: "imageData must be a base64 data URL" }, { status: 400 });
  }

  const [, mediaType, base64] = match;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const result = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 350,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: base64,
              },
            },
            {
              type: "text",
              text:
                "Read only enough visible text to locate this page in a local book corpus. Return JSON only in this shape: {\"anchors\":[\"...\"]}. Each anchor must be an exact short OCR phrase of 5-12 consecutive words visible in the image, under 90 characters. Return 3-6 anchors if possible. Do not summarize, identify the book, or transcribe the full page.",
            },
          ],
        },
      ],
    });
    const text = result.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    if (/not able to reproduce|copyright|can't provide|cannot provide|summarize/i.test(text)) {
      return NextResponse.json(
        { error: "OCR returned a summary/refusal instead of exact page anchors. Try a tighter crop of the page text." },
        { status: 422 },
      );
    }

    let anchors: string[] = [];
    try {
      const parsed = JSON.parse(text) as { anchors?: unknown };
      if (Array.isArray(parsed.anchors)) {
        anchors = parsed.anchors.filter((anchor): anchor is string => typeof anchor === "string");
      }
    } catch {
      anchors = text
        .split(/\n+/)
        .map((line) => line.replace(/^[-*"'\s]+|[-*"'\s]+$/g, ""))
        .filter(Boolean);
    }

    const usableAnchors = anchors
      .map((anchor) => anchor.replace(/\s+/g, " ").trim())
      .filter((anchor) => anchor.split(/\s+/).length >= 5 && anchor.length <= 140)
      .slice(0, 6);
    if (!usableAnchors.length) {
      return NextResponse.json(
        { error: "OCR could not read enough exact page words. Try a clearer screenshot or paste 1-2 visible lines." },
        { status: 422 },
      );
    }

    return NextResponse.json({ text: usableAnchors.join("\n"), anchors: usableAnchors });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OCR failed" }, { status: 500 });
  }
}
