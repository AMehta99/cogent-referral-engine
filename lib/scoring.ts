import type { Job, Referral } from "./types";

/**
 * Composite Scoring Algorithm
 *
 * composite_score = (
 *   fit_score        * 0.40 +
 *   priority_score   * 0.25 +
 *   headcount_gap    * 0.20 +
 *   referral_overlap * 0.15
 * )
 */

// ------------------------------------------------------------------
// [YOU PLUG IN] — Scoring Weights
// ------------------------------------------------------------------
// TODO: Review the weight distribution (40/25/20/15).
//       Adjust based on what feels right for Cogent's situation.
//       This is a good talking point for the interview — why these weights?
//
//       Current rationale:
//       - fit_score (0.40): Strongest signal — does this person actually fit the role?
//       - priority_score (0.25): Critical roles should rank higher
//       - headcount_gap (0.20): Roles with more unfilled seats are more urgent
//       - referral_overlap (0.15): Multiple referrers = social proof / stronger signal
// ------------------------------------------------------------------
const WEIGHTS = {
  fit: 0.40,
  priority: 0.25,
  headcountGap: 0.20,
  referralOverlap: 0.15,
};

/**
 * Map job priority to a numeric score.
 */
function priorityScore(priority: string): number {
  switch (priority) {
    case "critical": return 1.0;
    case "high": return 0.7;
    case "medium": return 0.4;
    default: return 0.0;
  }
}

/**
 * Calculate the headcount gap score.
 * Normalized as (openings - filled) / max_openings across all roles.
 */
function headcountGapScore(job: Job, allJobs: Job[]): number {
  const maxOpenings = Math.max(...allJobs.map((j) => j.openings));
  if (maxOpenings === 0) return 0;
  return (job.openings - job.filled) / maxOpenings;
}

/**
 * Calculate referral overlap score.
 * If N people referred the same connection for the same role, score = min(N / 3, 1.0).
 */
function referralOverlapScore(
  connectionId: string,
  jobId: string,
  allReferrals: Array<{ connection_id: string; job_id: string }>
): number {
  const count = allReferrals.filter(
    (r) => r.connection_id === connectionId && r.job_id === jobId
  ).length;
  return Math.min(count / 3, 1.0);
}

/**
 * Calculate the composite score for a referral.
 */
export function calculateCompositeScore(params: {
  fitScore: number;
  job: Job;
  allJobs: Job[];
  connectionId: string;
  jobId: string;
  allReferrals: Array<{ connection_id: string; job_id: string }>;
}): number {
  const { fitScore, job, allJobs, connectionId, jobId, allReferrals } = params;

  const composite =
    fitScore * WEIGHTS.fit +
    priorityScore(job.priority) * WEIGHTS.priority +
    headcountGapScore(job, allJobs) * WEIGHTS.headcountGap +
    referralOverlapScore(connectionId, jobId, allReferrals) * WEIGHTS.referralOverlap;

  // Clamp to [0, 1]
  return Math.min(Math.max(composite, 0), 1);
}

export { WEIGHTS, priorityScore, headcountGapScore, referralOverlapScore };
