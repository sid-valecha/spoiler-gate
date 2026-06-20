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
      max_tokens: 1200,
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
                "Extract the visible book page text from this image. Return only the readable page text, preserving paragraph order. Do not summarize or explain.",
            },
          ],
        },
      ],
    });
    const text = result.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OCR failed" }, { status: 500 });
  }
}
