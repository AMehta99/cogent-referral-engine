"use client";

import type { JobPriority } from "@/lib/types";

const PRIORITY_COLORS: Record<JobPriority, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-gray-100 text-gray-600",
};

export default function PriorityBadge({ priority }: { priority: JobPriority }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLORS[priority]}`}>
      {priority}
    </span>
  );
}
