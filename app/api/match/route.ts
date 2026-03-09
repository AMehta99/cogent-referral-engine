import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/match
 *
 * Creates an Anthropic Message Batch — one request per connection — and
 * returns { batchId } immediately. The frontend polls /api/match/status
 * until the batch completes.
 *
 * Why Batches API:
 * - Runs outside real-time rate limits (no TPM/concurrent-connection limits)
 * - 50% cheaper per token than synchronous calls
 * - Handles any connection volume without timing out
 */

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a recruiting assistant for Cogent Security, an Applied AI Lab building AI agents for cybersecurity.

Match the provided LinkedIn connection to the single best-fit open role based on their headline/title.

Consider:
- Direct keyword and skill matches between the person's title and the job keywords
- Seniority alignment (e.g., "Senior" titles match senior roles; ICs vs managers)
- Domain relevance (e.g., ML/AI → AI Engineer; DevOps → Platform/Infra; GTM/Sales → sales roles)
- Adjacent skills that transfer well across functions

Be selective. Scoring guide:
- 0.9+: Exceptional fit — title and domain are nearly identical to the role
- 0.7–0.89: Strong fit — clear overlap in function, domain, and seniority
- 0.5–0.69: Borderline — some relevant signal but meaningful gaps
- Below 0.5: Not a match — return null for matched_job_id

Return null for matched_job_id if there is no meaningful match.`;

function buildUserPrompt(
  connection: { id: string; headline: string },
  jobs: Array<{ id: string; title: string; department: string; keywords: string[] | string }>
): string {
  return `Match this LinkedIn connection to the best-fit open role.

Open Roles:
${JSON.stringify(jobs, null, 2)}

Connection to evaluate:
${JSON.stringify(connection, null, 2)}

Return a JSON object with exactly these fields:
- matched_job_id: the id of the best-fit job (string), or null if no meaningful match
- fit_score: number from 0 to 1
- reasoning: one sentence explaining the match or why there is no match

Return ONLY the JSON object. No markdown, no extra text.`;
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

    // Pass title, department, and keywords for each job so Claude has full context.
    // Descriptions are intentionally omitted — they are very long and keywords
    // already capture the signal needed for headline-level matching.
    const simplifiedJobs = jobs.map((j: any) => ({
      id: j.id,
      title: j.title,
      department: j.department ?? "",
      keywords: j.keywords ?? [],
    }));

    const simplifiedConnections = connections.map((c: any) => ({
      id: c.id,
      headline: c.headline ?? c.title ?? "",
    }));

    // Build one Batch API request per connection
    const batchRequests = simplifiedConnections.map((c: any) => ({
      custom_id: c.id,
      params: {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(c, simplifiedJobs),
          },
        ],
      },
    }));

    console.log(`Creating Anthropic batch with ${batchRequests.length} requests`);

    const response = await fetch("https://api.anthropic.com/v1/messages/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "message-batches-2024-09-24",
      },
      body: JSON.stringify({ requests: batchRequests }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Batch API error:", errorText);
      return NextResponse.json(
        { error: `Batch API error: ${response.status}` },
        { status: 500 }
      );
    }

    const batch = await response.json();
    console.log(`Batch created: ${batch.id}, status: ${batch.processing_status}`);

    return NextResponse.json({ batchId: batch.id });
  } catch (error) {
    console.error("Match API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
