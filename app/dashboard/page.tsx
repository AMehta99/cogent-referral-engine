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

type Tab = "readme" | "engine" | "dashboard";

const HOW_IT_WORKS = [
  {
    emoji: "🔗",
    title: "Export your LinkedIn network",
    body: "Download your connections CSV from LinkedIn (Settings → Data Privacy → Get a copy of your data). This gives us your full network — names, titles, companies, and URLs.",
  },
  {
    emoji: "🤖",
    title: "AI scans every connection",
    body: "Our engine reads each person's current title and experience, then scores them against every open role at Cogent. You don't have to manually filter anyone — AI handles the entire match.",
  },
  {
    emoji: "🎯",
    title: "Only the best matches surface",
    body: "Candidates are ranked by fit score, role priority, headcount gap, and how much referral coverage a role already has. You only see people genuinely worth referring.",
  },
  {
    emoji: "📋",
    title: "You review and submit",
    body: "You get to see why each person was matched before submitting. You're in control — submit the ones you vouch for, skip the rest. Your name is attached, so quality matters.",
  },
  {
    emoji: "📬",
    title: "The recruiting team takes it from here",
    body: "Every submitted referral lands in the admin dashboard, ranked and ready. The recruiting team reviews the top candidates and reaches out — you'll see their progress in your dashboard.",
  },
  {
    emoji: "💡",
    title: "No LinkedIn access? No problem",
    body: "You can also add people manually — just enter their name, current title, and LinkedIn URL. Claude will still score the fit and route them to the right role.",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [referrals, setReferrals] = useState<ReferralWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMatching, setIsMatching] = useState(false);
  const [matchingStatus, setMatchingStatus] = useState<string>("");
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Tab>("readme");

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

      if (profileError || !profile) {
        await supabase.auth.signOut();
        router.push("/login");
        return;
      }
      if (profile.role === "admin") { router.push("/admin"); return; }

      setUser(profile as Profile);

      const { data: jobsData } = await supabase.from("jobs").select("*");
      setJobs((jobsData || []) as Job[]);

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

  const handleCSVUpload = useCallback(
    async (csvText: string) => {
      if (!user) return;
      setIsMatching(true);
      setMatchingStatus("Parsing connections...");

      try {
        const parsed = parseLinkedInCSV(csvText, user.id);

        if (parsed.length === 0) {
          alert("No valid connections found in the CSV. Ensure rows have Position and URL fields.");
          setIsMatching(false);
          setMatchingStatus("");
          return;
        }

        // ------------------------------------------------------------------
        // Cap at 200 connections to stay within the Anthropic API's
        // 10,000 output-token-per-minute rate limit. 200 connections ×
        // ~120 tokens/result = ~24,000 tokens across 5 batches run 2 at
        // a time — safely under the limit and well within Vercel's 60s timeout.
        // LinkedIn exports are sorted by most recent connection first, so
        // we're keeping the 200 people the user connected with most recently.
        // ------------------------------------------------------------------
        const MAX_CONNECTIONS = 200;
        const capped = parsed.slice(0, MAX_CONNECTIONS);
        const wasLimited = parsed.length > MAX_CONNECTIONS;

        setMatchingStatus(`Saving ${capped.length} connections...`);

        const { data: insertedConnections, error: insertError } = await supabase
          .from("connections")
          .insert(capped)
          .select();

        if (insertError) throw insertError;
        if (!insertedConnections) throw new Error("Failed to insert connections");

        setConnections(insertedConnections as Connection[]);

        const connectionsForMatching = insertedConnections.map((c: any) => ({
          id: c.id,
          headline: c.headline,
        }));

        const jobsForMatching = jobs.map((j) => ({
          id: j.id,
          title: j.title,
          department: (j as any).department ?? "",
          keywords: j.keywords,
        }));

        setMatchingStatus(`Scanning ${insertedConnections.length} connections against open roles…`);

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
        const goodMatches = matchResults.filter(
          (m) => m.matched_job_id && m.fit_score >= 0.5
        );
        setMatches(goodMatches);

        if (wasLimited) {
          alert(
            `Your CSV had ${parsed.length} connections. We scanned the most recent ${MAX_CONNECTIONS} to stay within API limits. To scan more, re-export and upload again — we'll pick up where you left off.`
          );
        }
      } catch (error: any) {
        console.error("Upload/match error:", error);
        alert(`Error: ${error.message}`);
      } finally {
        setIsMatching(false);
        setMatchingStatus("");
      }
    },
    [user, jobs]
  );

  async function handleSubmitReferral(match: MatchResult) {
    if (!user || !match.matched_job_id) return;

    setSubmittingIds((prev) => new Set(prev).add(match.connection_id));

    try {
      const job = jobs.find((j) => j.id === match.matched_job_id);
      if (!job) throw new Error("Job not found");

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

  async function handleBulkSubmit() {
    const unsubmitted = matches.filter(
      (m) => m.matched_job_id && !submittedIds.has(m.connection_id)
    );
    for (const match of unsubmitted) {
      await handleSubmitReferral(match);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "readme", label: "Read Me" },
    { id: "engine", label: "Referral Engine" },
    { id: "dashboard", label: "My Referral Dashboard" },
  ];

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
            <p className="text-xs text-gray-500">
              AI-powered referrals from your network to drive Cogent&apos;s growth
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.full_name}</span>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4">
          <nav className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">

        {/* ── Tab 1: Read Me ── */}
        {activeTab === "readme" && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">How the Referral Engine works</h2>
              <p className="mt-2 text-gray-500 text-sm">
                Your network is one of Cogent&apos;s most powerful recruiting assets. Here&apos;s exactly what
                happens when you participate — and what we need from you.
              </p>
            </div>

            <div className="space-y-4">
              {HOW_IT_WORKS.map((item, i) => (
                <div
                  key={i}
                  className="flex gap-4 bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm"
                >
                  <span className="text-2xl mt-0.5 shrink-0">{item.emoji}</span>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{item.title}</p>
                    <p className="text-gray-500 text-sm mt-0.5 leading-relaxed">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 text-sm text-blue-700">
              <span className="font-semibold">Ready to start?</span> Head to the{" "}
              <button
                onClick={() => setActiveTab("engine")}
                className="underline font-semibold hover:text-blue-900"
              >
                Referral Engine
              </button>{" "}
              tab to upload your network or add someone manually.
            </div>
          </div>
        )}

        {/* ── Tab 2: Referral Engine ── */}
        {activeTab === "engine" && (
          <div className="space-y-8">
            {/* Option 1: CSV */}
            <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      Option 1
                    </span>
                    <h2 className="text-base font-semibold text-gray-900">Upload your LinkedIn connections</h2>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    The fastest way to surface matches. Export your full network from LinkedIn and drop the
                    CSV here — AI will scan every connection against all open roles automatically.
                  </p>
                </div>
              </div>
              <div className="text-xs text-gray-400 mb-3">
                LinkedIn → Settings &amp; Privacy → Data Privacy → Get a copy of your data → Connections
              </div>
              <CSVUploader onUpload={handleCSVUpload} isLoading={isMatching} />
              {isMatching && matchingStatus && (
                <p className="text-sm text-gray-500 mt-3 text-center animate-pulse">
                  {matchingStatus}
                </p>
              )}
            </section>

            {/* Match Results */}
            {matches.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-gray-900">
                    AI Matches — {matches.filter((m) => m.matched_job_id).length} found
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

            {/* Option 2: Manual */}
            <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                      Option 2
                    </span>
                    <h2 className="text-base font-semibold text-gray-900">Add someone manually</h2>
                  </div>
                  <p className="text-sm text-gray-500">
                    Know someone great but don&apos;t want to export your whole network? Add them directly.
                    We ask for their current title instead of scraping LinkedIn — it keeps things fast
                    and avoids any data privacy issues.
                  </p>
                </div>
                {user && jobs.length > 0 && (
                  <div className="ml-6 shrink-0">
                    <ManualReferralForm
                      jobs={jobs}
                      userId={user.id}
                      onSuccess={() => loadReferrals(user.id)}
                    />
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ── Tab 3: My Referral Dashboard ── */}
        {activeTab === "dashboard" && (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">My Referral Dashboard</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Track the people you&apos;ve referred and where they are in the process. This view is read-only —
                the recruiting team manages status updates.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <ReferralTable referrals={referrals} />
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
