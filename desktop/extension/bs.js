/* Reading Brightspace (D2L) answers: has this assignment/quiz been submitted? Pure functions, tested in tests/bs_test.js.
   Each returns { submitted: true | false | null, date } where null means "couldn't tell" (Game Plan then changes nothing). */

export function latestLe(versions) {
  const le = (Array.isArray(versions) ? versions : []).find((v) => v && v.ProductCode === "le");
  return le && le.LatestVersion ? String(le.LatestVersion) : null;
}

/* GET /d2l/api/le/{v}/{ou}/dropbox/folders/{db}/submissions/mysubmissions/
   → either EntityDropbox blocks ({ Status, Submissions: [...] }) or Submission blocks ({ SubmissionDate }). */
export function parseMySubmissions(data) {
  if (!Array.isArray(data)) return { submitted: null, date: null };
  const subs = data.flatMap((e) => (e && Array.isArray(e.Submissions) ? e.Submissions : e && "SubmissionDate" in e ? [e] : []));
  const statusSaysYes = data.some((e) => e && (e.Status === 1 || e.Status === 3));
  const dates = subs.map((s) => s && s.SubmissionDate).filter(Boolean).sort();
  if (subs.length || statusSaysYes) return { submitted: true, date: dates.length ? dates[dates.length - 1] : null };
  return { submitted: false, date: null };
}

/* The Assignments page (folders_list.d2l): each folder row links with db=<id>, then says "1 Submission, 1 File" or "Not Submitted". */
export function parseFolderList(html, db) {
  const text = String(html || "");
  const at = text.search(new RegExp("[?&;]db=" + db + "(?![0-9])"));
  if (at < 0) return { submitted: null, date: null };
  const other = /[?&;]db=(\d+)/g;               // the row ends where a link to a different folder starts
  other.lastIndex = at + 4;
  let end = Math.min(text.length, at + 4000), m;
  while ((m = other.exec(text)) && m.index < end) if (m[1] !== String(db)) { end = m.index; break; }
  const row = text.slice(at, end).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const n = row.match(/(\d+)\s*Submissions?\b/i);
  if (n) return { submitted: Number(n[1]) > 0, date: null };
  if (/Not\s+Submitted/i.test(row)) return { submitted: false, date: null };
  return { submitted: null, date: null };
}

/* The quiz summary page: a completed attempt shows up as "Attempt 1" with a completion/score, none means not taken. */
export function parseQuizSummary(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  if (/Attempt\s*1\b.{0,300}?(Completed|Submitted|Score|Grade)/i.test(text) || /Completed Attempts?\s*:?\s*[1-9]/i.test(text)) {
    return { submitted: true, date: null };
  }
  if (/(Completed Attempts?\s*:?\s*0\b|You have not (yet )?(attempted|started)|No attempts)/i.test(text)) return { submitted: false, date: null };
  return { submitted: null, date: null };
}
