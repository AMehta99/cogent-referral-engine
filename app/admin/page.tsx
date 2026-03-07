"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ReferralTable from "@/components/ReferralTable";
import type { Job, Profile, ReferralStatus, ReferralWithDetails } from "@/lib/types";

interface JobPipelineRow {
  job: Job;
  inFunnel: number;   // submitted + contacted + interviewing
  hired: number;
  openSpots: number;  // openings - hired (floor 0)
}

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [referrals, setReferrals] = useState<ReferralWithDetails[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, submitted: 0, interviewing: 0, hired: 0 });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (!profile || profile.role !== "admin") {
        router.push("/dashboard");
        return;
      }

      setUser(profile as Profile);
      await loadData();
      setLoading(false);
    }
    init();
  }, [router]);

  async function loadData() {
    const [referralsRes, jobsRes] = await Promise.all([
      supabase
        .from("referrals")
        .select("*, connection:connections(*), job:jobs(*), referrer:profiles!referred_by(*)")
        .order("composite_score", { ascending: false }),
      supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

    if (referralsRes.data) {
      const refs = referralsRes.data as unknown as ReferralWithDetails[];
      setReferrals(refs);
      setStats({
        total: refs.length,
        submitted: refs.filter((r) => r.status === "submitted").length,
        interviewing: refs.filter((r) => r.status === "interviewing").length,
        hired: refs.filter((r) => r.status === "hired").length,
      });
    }

    if (jobsRes.data) {
      setJobs(jobsRes.data as Job[]);
    }
  }

  async function handleStatusChange(referralId: string, newStatus: ReferralStatus) {
    const { error } = await supabase
      .from("referrals")
      .update({ status: newStatus })
      .eq("id", referralId);

    if (error) {
      console.error("Status update error:", error);
      alert("Failed to update status");
      return;
    }

    await loadData();
  }

  async function handleSyncJobs() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/sync-jobs", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncResult(
        `Synced: +${data.inserted} added, −${data.deleted} removed (${data.total_on_ashby} live on Ashby)`
      );
      await loadData();
    } catch (err: any) {
      setSyncResult(`Error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  // Build pipeline rows — one per job that has at least one referral or opening
  const pipelineRows: JobPipelineRow[] = jobs.map((job) => {
    const jobReferrals = referrals.filter((r) => r.job_id === job.id);
    const hired = jobReferrals.filter((r) => r.status === "hired").length;
    const inFunnel = jobReferrals.filter((r) =>
      ["submitted", "contacted", "interviewing"].includes(r.status)
    ).length;
    const openSpots = Math.max(0, job.openings - hired);
    return { job, inFunnel, hired, openSpots };
  });

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
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Cogent Referral Engine</h1>
            <p className="text-xs text-gray-500">Admin Dashboard</p>
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
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Referrals", value: stats.total, color: "text-gray-900" },
            { label: "Submitted", value: stats.submitted, color: "text-blue-600" },
            { label: "Interviewing", value: stats.interviewing, color: "text-yellow-600" },
            { label: "Hired", value: stats.hired, color: "text-green-600" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-500">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Role Pipeline */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Role Pipeline</h2>
            <div className="flex items-center gap-3">
              {syncResult && (
                <span className={`text-xs ${syncResult.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
                  {syncResult}
                </span>
              )}
              <button
                onClick={handleSyncJobs}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {syncing ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Syncing…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Sync Jobs from Ashby
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {pipelineRows.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">No jobs yet. Sync from Ashby to get started.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-2 px-4 font-medium text-gray-600">Role</th>
                    <th className="text-left py-2 px-4 font-medium text-gray-600">Dept</th>
                    <th className="text-center py-2 px-4 font-medium text-gray-600">Openings</th>
                    <th className="text-center py-2 px-4 font-medium text-gray-600">Hired</th>
                    <th className="text-center py-2 px-4 font-medium text-gray-600">In Funnel</th>
                    <th className="text-center py-2 px-4 font-medium text-gray-600">Open Spots</th>
                    <th className="text-left py-2 px-4 font-medium text-gray-600">Funnel Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {pipelineRows.map(({ job, inFunnel, hired, openSpots }) => {
                    const coveragePct = job.openings > 0
                      ? Math.min(100, Math.round((inFunnel / job.openings) * 100))
                      : 0;
                    const barColor =
                      coveragePct >= 100 ? "bg-green-500" :
                      coveragePct >= 50  ? "bg-blue-500" :
                                           "bg-orange-400";

                    return (
                      <tr key={job.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2.5 px-4 font-medium text-gray-900">{job.title}</td>
                        <td className="py-2.5 px-4 text-gray-500 text-xs">{job.department}</td>
                        <td className="py-2.5 px-4 text-center text-gray-700">{job.openings}</td>
                        <td className="py-2.5 px-4 text-center text-green-600 font-medium">{hired}</td>
                        <td className="py-2.5 px-4 text-center text-blue-600 font-medium">{inFunnel}</td>
                        <td className="py-2.5 px-4 text-center">
                          <span className={`font-medium ${openSpots === 0 ? "text-green-600" : "text-gray-700"}`}>
                            {openSpots === 0 ? "Filled" : openSpots}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${barColor}`}
                                style={{ width: `${coveragePct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-9 text-right">{coveragePct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Referrals Table */}
        <section>
          <h2 className="text-lg font-semibold mb-3">All Referrals</h2>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <ReferralTable
              referrals={referrals}
              isAdmin
              onStatusChange={handleStatusChange}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
