"use client";

import type { ReferralStatus } from "@/lib/types";

const STATUS_OPTIONS: ReferralStatus[] = [
  "suggested",
  "submitted",
  "contacted",
  "interviewing",
  "hired",
  "passed",
];

const STATUS_COLORS: Record<ReferralStatus, string> = {
  suggested: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  contacted: "bg-purple-100 text-purple-700",
  interviewing: "bg-yellow-100 text-yellow-700",
  hired: "bg-green-100 text-green-700",
  passed: "bg-red-100 text-red-700",
};

interface StatusDropdownProps {
  value: ReferralStatus;
  onChange: (status: ReferralStatus) => void;
  disabled?: boolean;
}

export default function StatusDropdown({ value, onChange, disabled }: StatusDropdownProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ReferralStatus)}
      disabled={disabled}
      className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_COLORS[value]}`}
    >
      {STATUS_OPTIONS.map((status) => (
        <option key={status} value={status}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </option>
      ))}
    </select>
  );
}
