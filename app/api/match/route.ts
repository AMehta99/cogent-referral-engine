import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/match
 *
 * Matches connections to jobs synchronously using a concurrency-limited pool.
 * Connections are capped at MAX_CONNECTIONS on the client before this is called,
 * keeping total in-flight output tokens safely under the 10,000 TPM rate limit.
 */

export const maxDuration = 60;

// MAX_CONCURRENCY × max_tokens must stay under 10,000 (the output TPM limit).
// 3 × 3,000 = 9,000 — safely under the limit.
// BATCH_SIZE=25: 200 connections / 25 = 8 batches, 3 waves × ~12s ≈ 36s (well under 60s timeout).
const MAX_CONCURRENCY = 3;
const BATCH_SIZE = 25;

const SYSTEM_PROMPT = `You are a recruiting assistant for Cogent Security, an Applied AI Lab building AI agents for cybersecurity.

Match the provided LinkedIn connections to open roles across any function — engineering, operations, product, design, sales, marketing, finance, and more.

For each connection, evaluate their current title/headline against the available roles. Consider:
- Direct keyword and skill matches between the person's title and the job keywords
- Seniority alignment (e.g., "Senior" titles match senior roles)
- Domain relevance (e.g., ML/AI → AI Engineer; DevOps → Platform/Infra; GTM → sales roles)
- Adjacent skills that transfer well

Be selective. Scoring guide:
- 0.9+: Exceptional — title and domain are nearly identical to the role
- 0.7–0.89: Strong — clear overlap in function, domain, and seniority
- 0.5–0.69: Borderline — some relevant signal but meaningful gaps
- Below 0.5: Not a match — return null for matched_job_id

If someone clearly doesn't match any open role, return null for matched_job_id with a score of 0.`;

// ------------------------------------------------------------------
// Concurrency-limited pool.
// Runs up to maxConcurrency tasks simultaneously. As each task
// finishes it immediately picks up the next, keeping the pool full.
// Order of results is preserved.
// ------------------------------------------------------------------
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }, () => worker())
  );

  return results;
}

async function processBatch(
  batch: Array<{ id: string; headline: string }>,
  simplifiedJobs: Array<{ id: string; title: string; department: string; keywords: string }>,
  apiKey: string
): Promise<any[]> {
  const userPrompt = `Match these connections to the best-fit open role.

Open Roles (id, title, department, keywords):
${JSON.stringify(simplifiedJobs, null, 2)}

Connections to match (id, headline):
${JSON.stringify(batch, null, 2)}

For each connection, return the best-fit job based on keyword matches, seniority, and domain relevance.

Return a JSON array where each element has:
- connection_id: the connection's id
- matched_job_id: the best-fit job id (or null if no meaningful match)
- fit_score: 0 to 1 (0.5+ decent, 0.7+ strong, 0.9+ exceptional)
- reasoning: one short sentence (no quotes, no special characters, plain ASCII only)

IMPORTANT: Return ONLY a valid JSON array. No markdown, no code fences, no extra text.
All string values must use only plain ASCII characters — no curly quotes, em dashes, or non-ASCII symbols.
Escape any double quotes inside strings with a backslash.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Claude API error:", errorText);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text;

  let cleanText = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  // Extract the outermost JSON array
  const arrayStart = cleanText.indexOf("[");
  const arrayEnd = cleanText.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    cleanText = cleanText.slice(arrayStart, arrayEnd + 1);
  }

  // Sanitize: replace curly/smart quotes with straight ones, strip non-ASCII
  cleanText = cleanText
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D]/g, '"')   // curly double quotes
    .replace(/\u2013|\u2014/g, "-")    // en/em dashes
    .replace(/[^\x00-\x7F]/g, "");    // strip remaining non-ASCII

  try {
    return JSON.parse(cleanText);
  } catch (parseError: any) {
    console.error("JSON parse error in batch:", parseError.message);
    console.error("Response text (first 500 chars):", text.substring(0, 500));
    // Last resort: try to recover valid objects from partial JSON
    const recovered: any[] = [];
    const objPattern = /\{[^{}]*"connection_id"[^{}]*\}/g;
    let match;
    while ((match = objPattern.exec(cleanText)) !== null) {
      try {
        recovered.push(JSON.parse(match[0]));
      } catch {
        // skip unparseable fragment
      }
    }
    if (recovered.length > 0) {
      console.log(`Recovered ${recovered.length} results from partial JSON`);
      return recovered;
    }
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey || apiKey === "your-anthropic-api-key-here") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured." },
        { status: 500 }
      );
    }

    const { connections, jobs } = await request.json();

    if (!connections?.length || !jobs?.length) {
      return NextResponse.json(
        { error: "Missing connections or jobs data" },
        { status: 400 }
      );
    }

    const simplifiedJobs = jobs.map((j: any) => ({
      id: j.id,
      title: j.title,
      department: j.department ?? "",
      keywords: j.keywords ?? "",
    }));

    const simplifiedConnections = connections.map((c: any) => ({
      id: c.id,
      headline: c.headline ?? c.title ?? "",
    }));

    const batches: Array<typeof simplifiedConnections> = [];
    for (let i = 0; i < simplifiedConnections.length; i += BATCH_SIZE) {
      batches.push(simplifiedConnections.slice(i, i + BATCH_SIZE));
    }

    console.log(
      `Processing ${simplifiedConnections.length} connections across ${batches.length} batches (max ${MAX_CONCURRENCY} concurrent)`
    );

    const tasks = batches.map(
      (batch) => () => processBatch(batch, simplifiedJobs, apiKey)
    );

    const batchResults = await runWithConcurrency(tasks, MAX_CONCURRENCY);
    const allMatches = batchResults.flat();

    return NextResponse.json(allMatches);
  } catch (error) {
    console.error("Match API error:", error);
    return NextResponse.json(
      { error: "Internal server error during matching" },
      { status: 500 }
    );
  }
}
