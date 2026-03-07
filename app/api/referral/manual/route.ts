import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { calculateCompositeScore } from "@/lib/scoring";
import type { Job } from "@/lib/types";

/**
 * Ask Claude to score a single candidate against a specific job.
 */
async function getFitScore(
  headline: string,
  job: { title: string; keywords: string[] },
  apiKey: string
): Promise<{ fit_score: number; reasoning: string }> {
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
            content: `Rate how well this person fits the role.

Person's current title/headline: "${headline}"
Job title: "${job.title}"
Job keywords: ${(job.keywords || []).join(", ")}

Return ONLY a JSON object:
{"fit_score": 0.75, "reasoning": "One sentence explanation"}

fit_score rules: 0.5 = borderline, 0.7+ = strong match, 0.9+ = exceptional.
Return 0 if clearly not relevant (e.g. finance person for engineering role).`,
          },
        ],
      }),
    });

    if (!response.ok) {
      return { fit_score: 0.5, reasoning: "Unable to score automatically" };
    }

    const data = await response.json();
    const text = (data.content[0]?.text || "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.slice(start, end + 1));
    }
  } catch {
    // fall through
  }
  return { fit_score: 0.5, reasoning: "Manual referral — scored conservatively" };
}

/**
 * POST /api/referral/manual
 *
 * Creates a connection and referral for a manually entered person.
 * Body: { firstName, lastName, linkedinUrl, headline, jobId, userId }
 */
export async function POST(request: NextRequest) {
  try {
    const { firstName, lastName, linkedinUrl, headline, jobId, userId } =
      await request.json();

    if (!firstName || !lastName || !jobId || !userId || !headline) {
      return NextResponse.json(
        { error: "firstName, lastName, headline, jobId, and userId are required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const adminClient = createAdminClient();

    // ── Fetch the target job ─────────────────────────────────────────
    const { data: job, error: jobError } = await adminClient
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // ── Fetch all jobs + existing referrals for scoring context ──────
    const [{ data: allJobs }, { data: existingReferrals }] = await Promise.all([
      adminClient.from("jobs").select("*"),
      adminClient.from("referrals").select("connection_id, job_id"),
    ]);

    // ── Create the connection ────────────────────────────────────────
    const { data: connection, error: connError } = await adminClient
      .from("connections")
      .insert({
        user_id: userId,
        first_name: firstName,
        last_name: lastName,
        headline: headline || null,
        linkedin_url: linkedinUrl || null,
        company: null,
      })
      .select()
      .single();

    if (connError || !connection) {
      return NextResponse.json(
        { error: "Failed to create connection: " + (connError?.message || "") },
        { status: 500 }
      );
    }

    // ── Score against the selected job ───────────────────────────────
    const { fit_score, reasoning } = await getFitScore(
      headline,
      { title: job.title, keywords: job.keywords || [] },
      apiKey
    );

    const composite_score = calculateCompositeScore({
      fitScore: fit_score,
      job: job as Job,
      allJobs: (allJobs || []) as Job[],
      connectionId: connection.id,
      jobId,
      allReferrals: existingReferrals || [],
    });

    // ── Insert the referral ──────────────────────────────────────────
    const { data: referral, error: refError } = await adminClient
      .from("referrals")
      .insert({
        connection_id: connection.id,
        job_id: jobId,
        referred_by: userId,
        fit_score,
        composite_score,
        reasoning,
        status: "submitted",
      })
      .select()
      .single();

    if (refError || !referral) {
      return NextResponse.json(
        { error: "Failed to create referral: " + (refError?.message || "") },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, connection, referral, fit_score, composite_score });
  } catch (error: any) {
    console.error("Manual referral error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to add referral" },
      { status: 500 }
    );
  }
}
