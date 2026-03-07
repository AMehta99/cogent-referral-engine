import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

const ASHBY_API_URL =
  "https://api.ashbyhq.com/posting-api/job-board/cogent-security";

/**
 * Use Claude Haiku to extract technical keywords from a job title + description.
 */
async function extractKeywords(
  title: string,
  description: string,
  apiKey: string
): Promise<string[]> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Extract 5-8 technical skill keywords from this job posting for candidate matching.
Title: ${title}
Description: ${description.substring(0, 600)}

Return ONLY a JSON array of short keyword strings, e.g. ["Python", "ML", "AWS", "LLM"].
No other text.`,
          },
        ],
      }),
    });

    if (!response.ok) return [title];

    const data = await response.json();
    const text = (data.content[0]?.text || "").trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.slice(start, end + 1));
    }
  } catch {
    // Fall back to title as single keyword
  }
  return [title];
}

/**
 * POST /api/admin/sync-jobs
 *
 * Fetches live jobs from the Ashby job board and syncs them with the database:
 * - Inserts new jobs (not already in DB by ashby_id)
 * - Deletes jobs that were removed from Ashby (only ashby-sourced rows)
 * - Manually-seeded jobs (no ashby_id) are never touched
 */
export async function POST(request: NextRequest) {
  try {
    const adminClient = createAdminClient();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    // ── 1. Fetch live jobs from Ashby ────────────────────────────────
    const ashbyRes = await fetch(ASHBY_API_URL, { cache: "no-store" });
    if (!ashbyRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch from Ashby API" },
        { status: 502 }
      );
    }

    const ashbyData = await ashbyRes.json();
    const ashbyJobs: any[] = (ashbyData.jobs || []).filter(
      (j: any) => j.isListed
    );
    const ashbyIdSet = new Set(ashbyJobs.map((j: any) => j.id));

    // ── 2. Get existing DB jobs that came from Ashby ─────────────────
    const { data: existingJobs, error: fetchError } = await adminClient
      .from("jobs")
      .select("id, ashby_id, title");

    if (fetchError) throw fetchError;

    const ashbySourcedInDb = (existingJobs || []).filter(
      (j: any) => j.ashby_id
    );
    const existingAshbyIdSet = new Set(
      ashbySourcedInDb.map((j: any) => j.ashby_id as string)
    );
    const ashbyIdToDbId = new Map(
      ashbySourcedInDb.map((j: any) => [j.ashby_id as string, j.id as string])
    );

    // ── 3. Insert new jobs ───────────────────────────────────────────
    const newJobs = ashbyJobs.filter((j) => !existingAshbyIdSet.has(j.id));
    let insertedCount = 0;
    const insertErrors: string[] = [];

    for (const job of newJobs) {
      const keywords = await extractKeywords(
        job.title,
        job.descriptionPlain || "",
        apiKey
      );

      const { error } = await adminClient.from("jobs").insert({
        title: job.title,
        department: job.department || "Engineering",
        priority: "high" as const,
        openings: 1,
        filled: 0,
        description: job.descriptionPlain
          ? job.descriptionPlain.substring(0, 1200)
          : null,
        keywords,
        ashby_id: job.id,
      });

      if (error) {
        insertErrors.push(`${job.title}: ${error.message}`);
      } else {
        insertedCount++;
      }
    }

    // ── 4. Delete jobs removed from Ashby ────────────────────────────
    // Only touches rows that were originally synced from Ashby (have ashby_id set)
    const toDeleteAshbyIds = [...existingAshbyIdSet].filter(
      (id) => !ashbyIdSet.has(id)
    );
    let deletedCount = 0;
    const deleteErrors: string[] = [];

    for (const ashbyId of toDeleteAshbyIds) {
      const dbId = ashbyIdToDbId.get(ashbyId);
      if (!dbId) continue;

      const { error } = await adminClient
        .from("jobs")
        .delete()
        .eq("id", dbId);

      if (error) {
        deleteErrors.push(`DB id ${dbId}: ${error.message}`);
      } else {
        deletedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      total_on_ashby: ashbyJobs.length,
      inserted: insertedCount,
      deleted: deletedCount,
      ...(insertErrors.length > 0 && { insert_errors: insertErrors }),
      ...(deleteErrors.length > 0 && { delete_errors: deleteErrors }),
    });
  } catch (error: any) {
    console.error("sync-jobs error:", error);
    return NextResponse.json(
      { error: error.message || "Sync failed" },
      { status: 500 }
    );
  }
}
