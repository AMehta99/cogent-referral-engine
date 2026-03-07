import Papa from "papaparse";
import type { LinkedInCSVRow, Connection } from "./types";

/**
 * Parse a LinkedIn connections CSV export into structured Connection objects.
 *
 * LinkedIn CSV columns: First Name, Last Name, URL, Company, Position, Connected On
 * Rows with empty Position or URL are ignored per spec.
 */
export function parseLinkedInCSV(
  csvText: string,
  userId: string
): Omit<Connection, "id" | "uploaded_at">[] {
  const result = Papa.parse<LinkedInCSVRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    console.warn("CSV parsing warnings:", result.errors);
  }

  return result.data
    .filter((row) => {
      // Ignore rows with empty Position or URL
      const position = row["Position"]?.trim();
      const url = row["URL"]?.trim();
      return position && url;
    })
    .map((row) => ({
      user_id: userId,
      first_name: row["First Name"]?.trim() || "",
      last_name: row["Last Name"]?.trim() || "",
      headline: row["Position"]?.trim() || null,
      company: row["Company"]?.trim() || null,
      linkedin_url: row["URL"]?.trim() || null,
    }));
}
