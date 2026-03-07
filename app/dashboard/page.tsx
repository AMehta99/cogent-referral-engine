"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { parseLinkedInCSV } from "@/lib/csv-parser";
import CSVUploader from "@/components/CSVUploader";
import MatchCard from "@/components/MatchCard";
import ReferralTable from "@/components/ReferralTable";
import ManualReferralForm from "@/components/ManualReferralForm";
import type { Profile, Job, Connection, MatchResult, ReferralWithDetails } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [referrals, setReferrals] = useState<ReferralWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMatching, setIsMatching] = useState(false);
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());

  // Auth check and data load
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      // If profile row is missing (e.g. manually deleted), sign out and show login
      if (profileError || !profile) {
        await supabase.auth.signOut();
        router.push("/login");
        return;
      }
      if (profile.role === "admin") { router.push("/admin"); return; }

      setUser(profile as Profile);

      // Load jobs
      const { data: jobsData } = await supabase.from("jobs").select("*");
      setJobs((jobsData || []) as Job[]);

      // Load existing referrals
      await loadReferrals(session.user.id);
      setLoading(false);
    }
    init();
  }, [router]);

  async function loadReferrals(userId: string) {
    const { data } = await supabase
      .from("referrals")
      .select("*, connection:connections(*), job:jobs(*)")
      .eq("referred_by", userId)
      .order("created_at", { ascending: false });

    if (data) {
      setReferrals(data as unknown as ReferralWithDetails[]);
    }
  }

  // Handle CSV upload
  const handleCSVUpload = useCallback(
    async (csvText: string) => {
      if (!user) return;
      setIsMatching(true);

      try {
        // Parse CSV
        const parsed = parseLinkedInCSV(csvText, user.id);

        if (parsed.length === 0) {
          alert("No valid connections found in the CSV. Ensure rows have Position and URL fields.");
          setIsMatching(false);
          return;
        }

        // Insert connections into Supabase
        const { data: insertedConnections, error: insertError } = await supabase
          .from("connections")
          .insert(parsed)
          .select();

        if (insertError) throw insertError;
        if (!insertedConnections) throw new Error("Failed to insert connections");

        setConnections(insertedConnections as Connection[]);

        // Send to AI matching
        const connectionsForMatching = insertedConnections.map((c: any) => ({
          id: c.id,
          headline: c.headline,
        }));

        const jobsForMatching = jobs.map((j) => ({
          id: j.id,
          title: j.title,
          description: j.description,
          keywords: j.keywords,
        }));

        const response = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connections: connectionsForMatching,
            jobs: jobsForMatching,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Matching failed");
        }

        const matchResults: MatchResult[] = await response.json();
        // Only keep matches with fit_score >= 0.5 and a matched job
        const goodMatches = matchResults.filter(
          (m) => m.matched_job_id && m.fit_score >= 0.5
        );
        setMatches(goodMatches);
      } catch (error: any) {
        console.error("Upload/match error:", error);
        alert(`Error: ${error.message}`);
      } finally {
        setIsMatching(false);
      }
    },
    [user, jobs]
  );

  // Submit a referral
  async function handleSubmitReferral(match: MatchResult) {
    if (!user || !match.matched_job_id) return;

    setSubmittingIds((prev) => new Set(prev).add(match.connection_id));

    try {
      const job = jobs.find((j) => j.id === match.matched_job_id);
      if (!job) throw new Error("Job not found");

      // Calculate composite score
      const scoreResponse = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fitScore: match.fit_score,
          job,
          allJobs: jobs,
          connectionId: match.connection_id,
          jobId: match.matched_job_id,
          allReferrals: referrals.map((r) => ({
            connection_id: r.connection_id,
            job_id: r.job_id,
          })),
        }),
      });

      const { composite_score } = await scoreResponse.json();

      // Insert referral
      const { error: insertError } = await supabase.from("referrals").insert({
        connection_id: match.connection_id,
        job_id: match.matched_job_id,
        referred_by: user.id,
        fit_score: match.fit_score,
        composite_score: composite_score,
        reasoning: match.reasoning,
        status: "submitted",
      });

      if (insertError) throw insertError;

      setSubmittedIds((prev) => new Set(prev).add(match.connection_id));

      // Reload referrals
      await loadReferrals(user.id);
    } catch (error: any) {
      console.error("Submit error:", error);
      alert(`Error submitting referral: ${error.message}`);
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(match.connection_id);
        return next;
      });
    }
  }

  // Bulk submit
  async function handleBulkSubmit() {
    const unsubmitted = matches.filter(
      (m) => m.matched_job_id && !submittedIds.has(m.connection_id)
    );
    for (const match of unsubmitted) {
      await handleSubmitReferral(match);
    }
  }

  // Sign out
  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Cogent Referral Engine</h1>
            <p className="text-xs text-gray-500">Welcome, {user?.full_name}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        {/* CSV Upload */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Upload LinkedIn Connections</h2>
          <CSVUploader onUpload={handleCSVUpload} isLoading={isMatching} />
        </section>

        {/* Match Results */}
        {matches.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                AI Matches ({matches.filter((m) => m.matched_job_id).length} found)
              </h2>
              {matches.some((m) => !submittedIds.has(m.connection_id)) && (
                <button
                  onClick={handleBulkSubmit}
                  className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Submit All Referrals
                </button>
              )}
            </div>
            <div className="space-y-3">
              {matches
                .filter((m) => m.matched_job_id)
                .map((match) => {
                  const connection = connections.find((c) => c.id === match.connection_id);
                  const job = jobs.find((j) => j.id === match.matched_job_id);
                  if (!connection || !job) return null;
                  return (
                    <MatchCard
                      key={match.connection_id}
                      connection={connection}
                      job={job}
                      match={match}
                      onSubmit={() => handleSubmitReferral(match)}
                      isSubmitting={submittingIds.has(match.connection_id)}
                      isSubmitted={submittedIds.has(match.connection_id)}
                    />
                  );
                })}
            </div>
          </section>
        )}

        {/* Previous Referrals */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Your Referrals</h2>
            {user && jobs.length > 0 && (
              <ManualReferralForm
                jobs={jobs}
                userId={user.id}
                onSuccess={() => loadReferrals(user.id)}
              />
            )}
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <ReferralTable referrals={referrals} />
          </div>
        </section>
      </main>
    </div>
  );
}
