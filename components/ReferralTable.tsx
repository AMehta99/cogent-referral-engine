"use client";

import { useState } from "react";
import ScoreBadge from "./ScoreBadge";
import PriorityBadge from "./PriorityBadge";
import StatusDropdown from "./StatusDropdown";
import type { ReferralStatus, ReferralWithDetails } from "@/lib/types";

interface ReferralTableProps {
  referrals: ReferralWithDetails[];
  isAdmin?: boolean;
  onStatusChange?: (referralId: string, status: ReferralStatus) => void;
}

export default function ReferralTable({
  referrals,
  isAdmin,
  onStatusChange,
}: ReferralTableProps) {
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Guard: skip any referrals with missing joined data (e.g. dangling foreign keys)
  const validReferrals = referrals.filter((r) => r.connection != null && r.job != null);

  // Get unique values for filter dropdowns
  const roles = [...new Set(validReferrals.map((r) => r.job.title))];
  const statuses = [...new Set(validReferrals.map((r) => r.status))];

  // Apply filters
  let filtered = validReferrals;
  if (roleFilter !== "all") {
    filtered = filtered.filter((r) => r.job.title === roleFilter);
  }
  if (statusFilter !== "all") {
    filtered = filtered.filter((r) => r.status === statusFilter);
  }

  // Sort by composite score descending (default)
  filtered.sort((a, b) => b.composite_score - a.composite_score);

  if (validReferrals.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No referrals yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Filters */}
      {isAdmin && (
        <div className="flex gap-3 mb-4">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
          >
            <option value="all">All Roles</option>
            {roles.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
          >
            <option value="all">All Statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500 self-center">
            {filtered.length} referral{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 font-medium text-gray-600">Candidate</th>
              <th className="text-left py-2 px-3 font-medium text-gray-600">Current Title</th>
              <th className="text-left py-2 px-3 font-medium text-gray-600">Matched Role</th>
              <th className="text-left py-2 px-3 font-medium text-gray-600">Fit</th>
              {isAdmin && (
                <th className="text-left py-2 px-3 font-medium text-gray-600">Composite</th>
              )}
              {isAdmin && (
                <th className="text-left py-2 px-3 font-medium text-gray-600">Referred By</th>
              )}
              <th className="text-left py-2 px-3 font-medium text-gray-600">Status</th>
              <th className="text-left py-2 px-3 font-medium text-gray-600">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ref) => (
              <tr key={ref.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">
                      {ref.connection.first_name} {ref.connection.last_name}
                    </span>
                    {ref.connection.linkedin_url && (
                      <a
                        href={ref.connection.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                      </a>
                    )}
                  </div>
                </td>
                <td className="py-2 px-3 text-gray-600">{ref.connection.headline}</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1.5">
                    <span>{ref.job.title}</span>
                    <PriorityBadge priority={ref.job.priority} />
                  </div>
                </td>
                <td className="py-2 px-3">
                  <ScoreBadge score={ref.fit_score} />
                </td>
                {isAdmin && (
                  <td className="py-2 px-3">
                    <ScoreBadge score={ref.composite_score} />
                  </td>
                )}
                {isAdmin && (
                  <td className="py-2 px-3 text-gray-600">
                    {ref.referrer?.full_name || "—"}
                  </td>
                )}
                <td className="py-2 px-3">
                  {isAdmin && onStatusChange ? (
                    <StatusDropdown
                      value={ref.status}
                      onChange={(status) => onStatusChange(ref.id, status)}
                    />
                  ) : (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      ref.status === "hired" ? "bg-green-100 text-green-700" :
                      ref.status === "passed" ? "bg-red-100 text-red-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {ref.status.charAt(0).toUpperCase() + ref.status.slice(1)}
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-gray-500 text-xs">
                  {new Date(ref.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
