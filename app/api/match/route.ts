import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/match
 *
 * Receives a batch of connections + jobs, calls Claude API to match them.
 * Returns an array of MatchResult objects.
 */

// ------------------------------------------------------------------
// [YOU PLUG IN] — Claude API Key
// ------------------------------------------------------------------
// Ensure ANTHROPIC_API_KEY is set in .env.local
// Get your key from https://console.anthropic.com
// ------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a recruiting assistant for Cogent, a Series A AI startup.
Your task is to match LinkedIn connections to open engineering roles.

For each connection, evaluate their current title/headline against the available roles.
Consider:
- Direct keyword matches between the person's title and the job keywords
- Seniority alignment (e.g., "Senior" titles match senior roles)
- Domain relevance (e.g., ML/AI titles match ML/AI roles)
- Adjacent skills that transfer well (e.g., DevOps → Platform/Infra)

Be selective — only suggest strong matches. A fit_score of 0.5 means borderline,
0.7+ means strong match, 0.9+ means exceptional fit.

If someone clearly doesn't match any role (e.g., they're in marketing, sales, design, etc.),
return null for matched_job_id with a score of 0.`;

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

    // Simplify job data to avoid JSON parsing issues with special characters in descriptions
    const simplifiedJobs = jobs.map((j: any) => ({
      id: j.id,
      title: j.title,
      keywords: j.keywords,
    }));

    // Simplify connections — only pass id and headline to keep payload lean
    const simplifiedConnections = connections.map((c: any) => ({
      id: c.id,
      headline: c.headline ?? c.title ?? "",
    }));

    // ----------------------------------------------------------------
    // Batch connections to avoid hitting Claude's output token limit.
    // With max_tokens=4096 and ~50 chars per result entry, ~50 connections
    // per batch is safe and leaves room for reasoning text.
    // ----------------------------------------------------------------
    const BATCH_SIZE = 40;
    const batches: Array<typeof simplifiedConnections> = [];
    for (let i = 0; i < simplifiedConnections.length; i += BATCH_SIZE) {
      batches.push(simplifiedConnections.slice(i, i + BATCH_SIZE));
    }

    const allMatches: any[] = [];

    for (const batch of batches) {
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
        return NextResponse.json(
          { error: `Claude API error: ${response.status}` },
          { status: 500 }
        );
      }

      const data = await response.json();
      const text = data.content[0].text;

      // Parse the JSON response — robustly extract the JSON array regardless of surrounding text
      let cleanText = text.trim();

      // Strip markdown code fences (```json ... ``` or ``` ... ```)
      cleanText = cleanText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

      // If there's still non-JSON preamble, find the first '[' to extract just the array
      const arrayStart = cleanText.indexOf("[");
      const arrayEnd = cleanText.lastIndexOf("]");
      if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
        cleanText = cleanText.slice(arrayStart, arrayEnd + 1);
      }

      let batchMatches;
      try {
        batchMatches = JSON.parse(cleanText);
      } catch (parseError: any) {
        console.error("JSON parse error:", parseError.message);
        console.error("Response text (first 800 chars):", text.substring(0, 800));
        return NextResponse.json(
          { error: `Failed to parse Claude response: ${parseError.message}` },
          { status: 500 }
        );
      }

      allMatches.push(...batchMatches);
    }

    return NextResponse.json(allMatches);
  } catch (error) {
    console.error("Match API error:", error);
    return NextResponse.json(
      { error: "Internal server error during matching" },
      { status: 500 }
    );
  }
}
