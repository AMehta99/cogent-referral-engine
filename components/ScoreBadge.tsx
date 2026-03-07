"use client";

interface ScoreBadgeProps {
  score: number;
  label?: string;
}

export default function ScoreBadge({ score, label }: ScoreBadgeProps) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-400";
  const textColor =
    pct >= 75 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-red-700";

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-gray-500">{label}</span>}
      <div className="flex items-center gap-1.5">
        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-xs font-medium ${textColor}`}>{pct}%</span>
      </div>
    </div>
  );
}
