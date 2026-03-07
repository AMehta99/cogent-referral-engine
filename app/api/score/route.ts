import { NextRequest, NextResponse } from "next/server";
import { calculateCompositeScore } from "@/lib/scoring";
import type { Job } from "@/lib/types";

/**
 * POST /api/score
 *
 * Calculates the composite score for a referral.
 * Body: { fitScore, job, allJobs, connectionId, jobId, allReferrals }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { fitScore, job, allJobs, connectionId, jobId, allReferrals } = body;

    if (fitScore == null || !job || !allJobs || !connectionId || !jobId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const compositeScore = calculateCompositeScore({
      fitScore,
      job: job as Job,
      allJobs: allJobs as Job[],
      connectionId,
      jobId,
      allReferrals: allReferrals || [],
    });

    return NextResponse.json({ composite_score: compositeScore });
  } catch (error) {
    console.error("Score API error:", error);
    return NextResponse.json(
      { error: "Internal server error during scoring" },
      { status: 500 }
    );
  }
}
