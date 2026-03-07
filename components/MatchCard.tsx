"use client";

import ScoreBadge from "./ScoreBadge";
import PriorityBadge from "./PriorityBadge";
import type { Connection, Job, MatchResult } from "@/lib/types";

interface MatchCardProps {
  connection: Connection;
  job: Job;
  match: MatchResult;
  onSubmit: () => void;
  isSubmitting?: boolean;
  isSubmitted?: boolean;
}

export default function MatchCard({
  connection,
  job,
  match,
  onSubmit,
  isSubmitting,
  isSubmitted,
}: MatchCardProps) {
  const fullName = `${connection.first_name} ${connection.last_name}`;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 truncate">{fullName}</h3>
            {connection.linkedin_url && (
              <a
                href={connection.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 flex-shrink-0"
                title="View LinkedIn profile"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
            )}
          </div>
          <p className="text-sm text-gray-600 mb-1">{connection.headline}</p>
          {connection.company && (
            <p className="text-xs text-gray-500">at {connection.company}</p>
          )}
        </div>

        <div className="flex-shrink-0 text-right">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-700">{job.title}</span>
            <PriorityBadge priority={job.priority} />
          </div>
          <ScoreBadge score={match.fit_score} label="Fit" />
        </div>
      </div>

      {match.reasoning && (
        <p className="text-xs text-gray-500 mt-2 italic">{match.reasoning}</p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          onClick={onSubmit}
          disabled={isSubmitting || isSubmitted}
          className={`
            px-4 py-1.5 text-sm font-medium rounded-md transition-colors
            ${isSubmitted
              ? "bg-green-100 text-green-700 cursor-default"
              : isSubmitting
                ? "bg-gray-100 text-gray-400 cursor-wait"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }
          `}
        >
          {isSubmitted ? "Submitted" : isSubmitting ? "Submitting..." : "Submit Referral"}
        </button>
      </div>
    </div>
  );
}
