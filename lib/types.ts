// ============================================================
// Cogent Referral Engine — TypeScript Types
// ============================================================

export type UserRole = "employee" | "admin";
export type JobPriority = "critical" | "high" | "medium";
export type ReferralStatus =
  | "suggested"
  | "submitted"
  | "contacted"
  | "interviewing"
  | "hired"
  | "passed";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface Job {
  id: string;
  title: string;
  department: string;
  priority: JobPriority;
  openings: number;
  filled: number;
  description: string | null;
  keywords: string[];
  ashby_id?: string | null;
  created_at: string;
}

export interface Connection {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  headline: string | null;
  company: string | null;
  linkedin_url: string | null;
  uploaded_at: string;
}

export interface Referral {
  id: string;
  connection_id: string;
  job_id: string;
  referred_by: string;
  fit_score: number;
  composite_score: number;
  reasoning: string | null;
  status: ReferralStatus;
  created_at: string;
}

// Joined types for display
export interface ReferralWithDetails extends Referral {
  connection: Connection;
  job: Job;
  referrer?: Profile;
}

// AI matching result
export interface MatchResult {
  connection_id: string;
  matched_job_id: string | null;
  fit_score: number;
  reasoning: string;
}

// LinkedIn CSV row
export interface LinkedInCSVRow {
  "First Name": string;
  "Last Name": string;
  URL: string;
  Company: string;
  Position: string;
  "Connected On": string;
}

// Supabase database type helper (minimal for client usage)
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Omit<Profile, "created_at">; Update: Partial<Profile> };
      jobs: { Row: Job; Insert: Omit<Job, "id" | "created_at">; Update: Partial<Job> };
      connections: { Row: Connection; Insert: Omit<Connection, "id" | "uploaded_at">; Update: Partial<Connection> };
      referrals: { Row: Referral; Insert: Omit<Referral, "id" | "created_at">; Update: Partial<Referral> };
    };
  };
};
