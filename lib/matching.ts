import type { Connection, Job, MatchResult } from "./types";

/**
 * AI Matching Logic — Uses Claude API to match connections to open roles.
 *
 * For each connection, sends the connection's headline/position and the list
 * of open jobs to Claude, asking for the best-fit job match.
 *
 * Only surfaces matches with fit_score >= 0.5.
 */

// ------------------------------------------------------------------
// [YOU PLUG IN] — AI Matching Prompt
// ------------------------------------------------------------------
// TODO: Review and customize this system prompt for matching.
//       Consider:
//       1. Tune the fit_score threshold (default 0.5)
//       2. Decide if you want to batch connections or send one-by-one
//          (batching is better for cost/speed — currently batched)
//       3. Adjust the prompt to better match Cogent's hiring criteria
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

const FIT_SCORE_THRESHOLD = 0.5;

/**
 * Match a batch of connections against open jobs using Claude API.
 */
export async function matchConnectionsToJobs(
  connections: Array<{ id: string; headline: string | null }>,
  jobs: Job[]
): Promise<MatchResult[]> {
  const jobSummaries = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    description: j.description,
    keywords: j.keywords,
  }));

  const connectionSummaries = connections.map((c) => ({
    id: c.id,
    headline: c.headline || "Unknown",
  }));

  // TODO: Replace this with actual Claude API call when API key is configured.
  // ------------------------------------------------------------------
  // [YOU PLUG IN] — Claude API Call
  // ------------------------------------------------------------------
  // When you return:
  // 1. Ensure ANTHROPIC_API_KEY is set in .env.local
  // 2. Review the SYSTEM_PROMPT above and adjust for your needs
  // 3. Optionally adjust FIT_SCORE_THRESHOLD (currently 0.5)
  //
  // The API call should look like:
  //
  //   const response = await fetch("https://api.anthropic.com/v1/messages", {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //       "x-api-key": process.env.ANTHROPIC_API_KEY!,
  //       "anthropic-version": "2023-06-01",
  //     },
  //     body: JSON.stringify({
  //       model: "claude-sonnet-4-20250514",
  //       max_tokens: 4096,
  //       system: SYSTEM_PROMPT,
  //       messages: [
  //         {
  //           role: "user",
  //           content: `Match these connections to the best-fit open role.
  //
  // Open Roles:
  // ${JSON.stringify(jobSummaries, null, 2)}
  //
  // Connections to match:
  // ${JSON.stringify(connectionSummaries, null, 2)}
  //
  // Return a JSON array where each element has:
  // - connection_id: the connection's id
  // - matched_job_id: the best-fit job id (or null if no good match)
  // - fit_score: 0 to 1
  // - reasoning: one sentence explaining the match
  //
  // Return ONLY the JSON array, no other text.`,
  //         },
  //       ],
  //     }),
  //   });
  //
  //   const data = await response.json();
  //   const text = data.content[0].text;
  //   const matches: MatchResult[] = JSON.parse(text);
  //   return matches.filter((m) => m.fit_score >= FIT_SCORE_THRESHOLD);
  // ------------------------------------------------------------------

  // TEMPORARY: Call the /api/match route which handles the actual API call
  // This is a stub that will be replaced when the API route is connected
  const response = await fetch("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connections: connectionSummaries, jobs: jobSummaries }),
  });

  if (!response.ok) {
    throw new Error(`Matching API error: ${response.status}`);
  }

  const matches: MatchResult[] = await response.json();
  return matches.filter((m) => m.fit_score >= FIT_SCORE_THRESHOLD);
}

export { SYSTEM_PROMPT, FIT_SCORE_THRESHOLD };
