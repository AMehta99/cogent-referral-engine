import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/match
 *
 * Receives a batch of connections + jobs, calls Claude API to match them.
 * Batches are processed in parallel to stay well within Vercel's timeout.
 * Returns an array of MatchResult objects.
 */

// Increase Vercel function timeout to maximum allowed on Hobby plan
export const maxDuration = 60;

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
// Process a single batch of connections against all jobs.
// Extracted so it can be called concurrently via Promise.all.
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
    // token limit. All batches are fired in parallel so total latency
    // equals the slowest single batch (~5-10s) rather than the sum.
    // 1,253 connections → ~13 parallel calls instead of 32 sequential.
    // ----------------------------------------------------------------
    const BATCH_SIZE = 100;
    const batches: Array<typeof simplifiedConnections> = [];
    for (let i = 0; i < simplifiedConnections.length; i += BATCH_SIZE) {
      batches.push(simplifiedConnections.slice(i, i + BATCH_SIZE));
    }

    console.log(`Processing ${simplifiedConnections.length} connections across ${batches.length} parallel batches`);

    const batchResults = await Promise.all(
      batches.map((batch) => processBatch(batch, simplifiedJobs, apiKey))
    );

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
