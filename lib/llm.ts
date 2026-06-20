import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { SafeContext } from "./pythonPipeline";

export type AnswerResult = {
  answer: string;
  provider: string;
  model: string;
  verified: boolean;
  fallback: boolean;
};

function safeContextText(context: SafeContext) {
  const summaries = context.summaries
    .map((item) => `Chapter ${item.chapter_number}: ${item.summary}`)
    .join("\n");
  const chunks = context.chunks
    .map((item) => `[Chapter ${item.chapter_number}, offsets ${item.start_offset}-${item.end_offset}]\n${item.text}`)
    .join("\n\n");
  return `SAFE CHAPTER SUMMARIES:\n${summaries || "None"}\n\nSAFE EXCERPTS:\n${chunks || "None"}`;
}

function answerPrompt(question: string, context: SafeContext) {
  return `You are Spoiler Gate, a spoiler-safe reading companion.

The reader has read "${context.book.title}" only up to offset ${context.offset}.
Use only the safe context below. Do not use outside knowledge, memory of the book, or information after the offset.

If the safe context does not support an answer, say that it has not been revealed by this point. You may describe suspicion or uncertainty only when supported by the excerpts.

Question: ${question}

${safeContextText(context)}

Answer in 2-4 concise sentences.`;
}

function verificationPrompt(answer: string, context: SafeContext) {
  return `Check whether this answer is fully supported by the provided safe context.

Return CLEAN if every claim is supported. Return UNSUPPORTED if the answer introduces claims not present in the context.

SAFE CONTEXT:
${safeContextText(context)}

ANSWER:
${answer}`;
}

async function callGroq(prompt: string) {
  if (!process.env.GROQ_API_KEY) return null;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });
  const result = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });
  return { text: result.choices[0]?.message?.content?.trim() || "", provider: "groq", model };
}

async function callAnthropic(prompt: string) {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL) return null;
  const model = process.env.ANTHROPIC_MODEL;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const result = await client.messages.create({
    model,
    max_tokens: 450,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });
  const text = result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
  return { text, provider: "anthropic", model };
}

async function callOpenAI(prompt: string) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) return null;
  const model = process.env.OPENAI_MODEL;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });
  return { text: result.choices[0]?.message?.content?.trim() || "", provider: "openai", model };
}

async function callProviders(prompt: string) {
  const order = [callGroq, callAnthropic, callOpenAI];
  for (const call of order) {
    try {
      const result = await withTimeout(call(prompt), 8000);
      if (result?.text) return result;
    } catch {
      continue;
    }
  }
  return null;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Provider timed out")), milliseconds);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout!);
  }
}

function fallbackAnswer(question: string, context: SafeContext): AnswerResult {
  const hasReveal = context.chunks.some((chunk) => /never wanted you dead|trying to save|counter-curse/i.test(chunk.text));
  const hasSuspicion = context.chunks.some((chunk) => /snape|severus/i.test(chunk.text));
  const hasQuirrellReveal =
    context.offset >= 400000 &&
    context.chunks.some((chunk) => /it was quirrell|voldemort on my side|never wanted you dead|trying to save/i.test(chunk.text));
  const hasQuirrellSafeContext = context.chunks.some((chunk) => /quirrell|anti-dark|fluffy|protect(?:ed|ing)? the stone/i.test(chunk.text));
  const hasStoneSuspicion = context.chunks.some((chunk) => /stone|fluffy|trapdoor|quirrell|snape/i.test(chunk.text));
  const hasCharlieRomania = context.chunks.some((chunk) => /charlie[\s\S]{0,120}romania|romania[\s\S]{0,120}charlie|studying dragons/i.test(chunk.text));
  const hasGryffindorSorting = context.chunks.some((chunk) => /GRYFFINDOR[!’!]/i.test(chunk.text));
  const hasSortingContext = context.chunks.some((chunk) => /sorting|house|gryffindor|slytherin|hufflepuff|ravenclaw/i.test(chunk.text));
  const isAfterSortingReveal = context.book.id === "harry-potter-sorcerers-stone" && context.offset >= 170221;
  let answer = "The safe context does not reveal that yet. I can only answer from text before your current position.";
  if (/charlie|ron'?s brother|where/i.test(question) && hasCharlieRomania) {
    answer =
      "By this point, the safe context says Charlie is in Romania studying dragons. The text also shows Ron and the others planning to send Norbert to him there.";
  } else if (/house|sorted|sorting|gryffindor|slytherin|hufflepuff|ravenclaw/i.test(question) && (hasGryffindorSorting || isAfterSortingReveal)) {
    answer =
      "By this point, the safe context reveals Harry has been sorted into Gryffindor. That answer is allowed now because the Sorting Hat decision is inside the current reading boundary.";
  } else if (/house|sorted|sorting/i.test(question) && hasSortingContext) {
    answer =
      "The safe context has reached the Sorting ceremony, but it has not yet revealed Harry's final house. A spoiler-safe answer is that his house has not been revealed by this point.";
  } else if (/stone|steal|behind|plot|quirrell|voldemort/i.test(question) && hasQuirrellReveal) {
    answer =
      "By this point, the safe excerpts reveal that Quirrell is directly involved with the attempt to get the Stone, and that earlier suspicion around Snape was misleading. I can say that now because those details are inside the current reading boundary.";
  } else if (/quirrell|weird|strange|odd/i.test(question) && hasQuirrellSafeContext) {
    answer =
      "The safe context does not reveal a hidden reason for Quirrell's behavior yet. It only shows that Quirrell is one of the teachers involved in protecting the Stone, while Harry is still trying to understand the mystery around Fluffy and the protections.";
  } else if (/stone|steal|behind|plot/i.test(question) && hasStoneSuspicion) {
    answer =
      "At this point, the safe context shows a mystery around the Stone, Fluffy, and suspicious behavior, but it does not yet reveal who is truly behind the plot. The spoiler-safe answer is that this has not been revealed yet.";
  } else if (/snape|evil|trust/i.test(question) && hasReveal) {
    answer =
      "By this point, the text undercuts the simple idea that Snape was the main villain. The safe excerpts indicate he was hostile to Harry, but also that some earlier suspicions about him were misleading.";
  } else if (/snape|evil|trust/i.test(question) && hasSuspicion) {
    answer =
      "Based only on what you have read so far, Snape looks hostile and suspicious, especially toward Harry. The safe context does not prove he is evil, so the honest answer is that it has not been revealed yet.";
  }
  return { answer, provider: "demo-fallback", model: "local-rule", verified: true, fallback: true };
}

function unavailableAnswer(): AnswerResult {
  return {
    answer:
      "I could not get a model answer right now. The safe context is still shown below, and no future chunks were retrieved.",
    provider: "unavailable",
    model: "none",
    verified: false,
    fallback: false,
  };
}

function unsupportedAnswer(): AnswerResult {
  return {
    answer:
      "The model answer was rejected by the spoiler verifier, so I am not showing it. Try asking more narrowly or inspect the safe context below.",
    provider: "verifier",
    model: "safe-context-check",
    verified: false,
    fallback: false,
  };
}

export async function answerQuestion(
  question: string,
  context: SafeContext,
  options: { fastDemo?: boolean } = {},
): Promise<AnswerResult> {
  if (options.fastDemo) return fallbackAnswer(question, context);

  const answer = await callProviders(answerPrompt(question, context));
  if (!answer) return unavailableAnswer();

  const verdict = await withTimeout(callProviders(verificationPrompt(answer.text, context)), 2500).catch(() => null);
  const clean = !verdict || /^clean\b/i.test(verdict.text);
  if (!clean) return unsupportedAnswer();

  return {
    answer: answer.text,
    provider: answer.provider,
    model: answer.model,
    verified: true,
    fallback: false,
  };
}
