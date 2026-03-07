"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ReferralTable from "@/components/ReferralTable";
import type { Profile, ReferralStatus, ReferralWithDetails } from "@/lib/types";

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [referrals, setReferrals] = useState<ReferralWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, submitted: 0, interviewing: 0, hired: 0 });

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
      await loadReferrals();
      setLoading(false);
    }
    init();
  }, [router]);

  async function loadReferrals() {
    const { data } = await supabase
      .from("referrals")
      .select("*, connection:connections(*), job:jobs(*), referrer:profiles!referred_by(*)")
      .order("composite_score", { ascending: false });

    if (data) {
      const refs = data as unknown as ReferralWithDetails[];
      setReferrals(refs);
      setStats({
        total: refs.length,
        submitted: refs.filter((r) => r.status === "submitted").length,
        interviewing: refs.filter((r) => r.status === "interviewing").length,
        hired: refs.filter((r) => r.status === "hired").length,
      });
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

    // Reload to get fresh data
    await loadReferrals();
  }

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
