import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/match
 *
 * Receives a batch of connections + jobs, calls Claude API to match them.
 * Batches are processed through a concurrency-limited pool to stay within
 * API rate limits while still running faster than pure sequential execution.
 * Returns an array of MatchResult objects.
 */

// Increase Vercel function timeout to maximum allowed on Hobby plan
export const maxDuration = 60;

// Maximum number of simultaneous in-flight Claude API requests.
// Keeps us under the concurrent-connections rate limit while still
// processing multiple batches at once.
const MAX_CONCURRENCY = 5;

const SYSTEM_PROMPT = `You are a recruiting assistant for Cogent, a Series A AI startup.
Your task is to match LinkedIn connections to open roles across any function — engineering,
operations, product, design, sales, marketing, finance, and more.

For each connection, evaluate their current title/headline against the available roles.
Consider:
- Direct keyword matches between the person's title and the job keywords
- Seniority alignment (e.g., "Senior" titles match senior roles)
- Domain relevance (e.g., ML/AI titles match ML/AI roles)
- Adjacent skills that transfer well (e.g., DevOps → Platform/Infra)

Be selective — only suggest strong matches. A fit_score of 0.5 means borderline,
0.7+ means strong match, 0.9+ means exceptional fit.

If someone clearly doesn't match any open role, return null for matched_job_id with a score of 0.`;

// ------------------------------------------------------------------
// Concurrency-limited pool.
// Runs up to maxConcurrency tasks simultaneously. As each task
// finishes it immediately picks up the next one, keeping the pool
// full until all work is done. Order of results is preserved.
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

  // Spin up exactly min(maxConcurrency, tasks.length) workers
  const workers = Array.from(
    { length: Math.min(maxConcurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

// ------------------------------------------------------------------
// Process a single batch of connections against all jobs.
// ------------------------------------------------------------------
async function processBatch(
  batch: Array<{ id: string; headline: string }>,
  simplifiedJobs: Array<{ id: string; title: string; keywords: string }>,
  apiKey: string
): Promise<any[]> {
  const userPrompt = `Match these connections to the best-fit open role.

Open Roles (id, title, keywords):
${JSON.stringify(simplifiedJobs, null, 2)}

Connections to match (id, headline):
${JSON.stringify(batch, null, 2)}

For each connection, find the best-fit job id based on:
- Keyword matches in their headline
- Seniority alignment
- Domain relevance

Return a JSON array where each element has:
- connection_id: the connection's id
- matched_job_id: the best-fit job id (or null if no good match)
- fit_score: 0 to 1 (0.5+ is decent, 0.7+ is strong, 0.9+ is exceptional)
- reasoning: one sentence explaining the match

Return ONLY the JSON array, no other text or markdown formatting.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
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

  // Robustly extract the JSON array regardless of surrounding text or markdown fences
  let cleanText = text.trim();
  cleanText = cleanText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  const arrayStart = cleanText.indexOf("[");
  const arrayEnd = cleanText.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    cleanText = cleanText.slice(arrayStart, arrayEnd + 1);
  }

  try {
    return JSON.parse(cleanText);
  } catch (parseError: any) {
    console.error("JSON parse error in batch:", parseError.message);
    console.error("Response text (first 800 chars):", text.substring(0, 800));
    // Return empty array for this batch rather than failing the entire request
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey || apiKey === "your-anthropic-api-key-here") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured. Add it to .env.local" },
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
      keywords: j.keywords,
    }));

    const simplifiedConnections = connections.map((c: any) => ({
      id: c.id,
      headline: c.headline ?? c.title ?? "",
    }));

    // ----------------------------------------------------------------
    // Batch size of 100 keeps each prompt well within Claude's output
    // token limit. Batches run through a pool capped at MAX_CONCURRENCY
    // concurrent requests — fast enough to finish within 60s, safe
    // enough to stay under the API's concurrent connection limit.
    // 1,253 connections → 13 batches → ~3 waves of 5 = ~24s total.
    // ----------------------------------------------------------------
    const BATCH_SIZE = 100;
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
