import Papa from "papaparse";
import type { LinkedInCSVRow, Connection } from "./types";

/**
 * Parse a LinkedIn connections CSV export into structured Connection objects.
 *
 * LinkedIn's official export prepends a multi-line "Notes:" preamble before
 * the real headers. We strip everything above the line that starts with
 * "First Name" so PapaParse sees a clean CSV.
 *
 * LinkedIn CSV columns: First Name, Last Name, URL, Email Address, Company, Position, Connected On
 * Rows with empty Position or URL are ignored per spec.
 */
export function parseLinkedInCSV(
  csvText: string,
  userId: string
): Omit<Connection, "id" | "uploaded_at">[] {
  // Find the line that contains the real headers and slice from there.
  // LinkedIn exports always start the data section with "First Name".
  const lines = csvText.split("\n");
  const headerLineIndex = lines.findIndex((line) =>
    line.trim().startsWith("First Name")
  );
  const cleanedCsv =
    headerLineIndex >= 0 ? lines.slice(headerLineIndex).join("\n") : csvText;

  const result = Papa.parse<LinkedInCSVRow>(cleanedCsv, {
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
