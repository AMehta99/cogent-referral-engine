import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/match/status?batchId=xxx
 *
 * Polls the Anthropic Message Batch status.
 * Returns { status: "processing", requestCounts } while in progress.
 * Returns { status: "ended", matches: MatchResult[] } when complete.
 */

export const maxDuration = 60;

const BATCH_HEADERS = (apiKey: string) => ({
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "message-batches-2024-09-24",
});

function extractJson(text: string): string {
  // Strip markdown fences
  let clean = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  // Find outermost JSON object
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    clean = clean.slice(start, end + 1);
  }
  return clean;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || apiKey === "your-anthropic-api-key-here") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured." },
      { status: 500 }
    );
  }

  const batchId = request.nextUrl.searchParams.get("batchId");
  if (!batchId) {
    return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  }

  const headers = BATCH_HEADERS(apiKey);

  // ------------------------------------------------------------------
  // Check batch processing status
  // ------------------------------------------------------------------
  const statusRes = await fetch(
    `https://api.anthropic.com/v1/messages/batches/${batchId}`,
    { headers }
  );

  if (!statusRes.ok) {
    return NextResponse.json(
      { error: `Failed to fetch batch status: ${statusRes.status}` },
      { status: 500 }
    );
  }

  const batch = await statusRes.json();

  if (batch.processing_status !== "ended") {
    return NextResponse.json({
      status: "processing",
      requestCounts: batch.request_counts,
    });
  }

  // ------------------------------------------------------------------
  // Batch is done — fetch and parse NDJSON results
  // ------------------------------------------------------------------
  const resultsRes = await fetch(
    `https://api.anthropic.com/v1/messages/batches/${batchId}/results`,
    { headers }
  );

  if (!resultsRes.ok) {
    return NextResponse.json(
      { error: `Failed to fetch batch results: ${resultsRes.status}` },
      { status: 500 }
    );
  }

  const ndjson = await resultsRes.text();
  const matches: any[] = [];
  let parseErrors = 0;

  for (const line of ndjson.trim().split("\n")) {
    if (!line.trim()) continue;

    try {
      const result = JSON.parse(line);

      if (result.result?.type !== "succeeded") {
        console.warn(
          `Non-success result for connection ${result.custom_id}: ${result.result?.type}`
        );
        continue;
      }

      const rawText = result.result.message.content[0].text;
      const cleanText = extractJson(rawText);
      const parsed = JSON.parse(cleanText);

      matches.push({
        connection_id: result.custom_id,
        matched_job_id: parsed.matched_job_id ?? null,
        fit_score: typeof parsed.fit_score === "number" ? parsed.fit_score : 0,
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      });
    } catch (e: any) {
      parseErrors++;
      console.error(`Failed to parse result line: ${e.message}`);
    }
  }

  if (parseErrors > 0) {
    console.warn(`${parseErrors} result lines failed to parse and were skipped`);
  }

  console.log(`Batch ${batchId} complete: ${matches.length} matches parsed`);

  return NextResponse.json({ status: "ended", matches });
}
