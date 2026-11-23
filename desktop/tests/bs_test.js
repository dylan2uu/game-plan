/* Tests for extension/bs.js. Run with macOS JavaScriptCore (no Node needed):
   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m desktop/tests/bs_test.js */
import { latestLe, parseMySubmissions, parseFolderList, parseQuizSummary } from "../extension/bs.js";

let failed = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  print((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
}

eq("latest le version", latestLe([{ ProductCode: "lp", LatestVersion: "1.40" }, { ProductCode: "le", LatestVersion: "1.79" }]), "1.79");
eq("no versions", latestLe("nope"), null);

eq("entity with a submission", parseMySubmissions([{ Status: 1, Submissions: [{ Id: 9, SubmissionDate: "2026-11-21T22:10:00.000Z" }] }]),
   { submitted: true, date: "2026-11-21T22:10:00.000Z" });
eq("latest of two submissions", parseMySubmissions([{ Submissions: [{ SubmissionDate: "2026-11-20T10:00:00Z" }, { SubmissionDate: "2026-11-21T10:00:00Z" }] }]).date,
   "2026-11-21T10:00:00Z");
eq("bare submission blocks", parseMySubmissions([{ Id: 1, SubmissionDate: "2026-11-02T01:00:00Z" }]).submitted, true);
eq("nothing submitted", parseMySubmissions([{ Status: 0, Submissions: [] }]), { submitted: false, date: null });
eq("empty list", parseMySubmissions([]), { submitted: false, date: null });
eq("not json array", parseMySubmissions({ Errors: [] }), { submitted: null, date: null });

const page = `<table>
 <tr><td><a href="/d2l/lms/dropbox/user/folder_submit_files.d2l?ou=534021&amp;db=270066">Programming Project 3 (PROJ3) - Collaboration Proposal</a>
   <div>Due on Nov 21, 2026 11:59 PM</div></td><td><a href="/d2l/lms/dropbox/user/folder_history.d2l?db=270066&amp;ou=534021">1 Submission, 1 File</a></td><td>- / -</td></tr>
 <tr><td><a href="/d2l/lms/dropbox/user/folder_submit_files.d2l?ou=534021&amp;db=270067">Programming Project 3 (PROJ3) - Coding</a></td>
   <td>Not Submitted</td><td>- / 100</td></tr>
 <tr><td><a href="/d2l/lms/dropbox/user/folder_submit_files.d2l?ou=534021&amp;db=2700">Other</a></td><td>0 Submissions</td></tr>
</table>`;
eq("assignments page: submitted row", parseFolderList(page, "270066").submitted, true);
eq("assignments page: not submitted row", parseFolderList(page, "270067").submitted, false);
eq("assignments page: 0 submissions", parseFolderList(page, "2700").submitted, false);
eq("assignments page: no such folder", parseFolderList(page, "999").submitted, null);

eq("quiz taken", parseQuizSummary("<h2>Attempt 1</h2><div>Completed - 4 / 5</div>").submitted, true);
eq("quiz completed attempts", parseQuizSummary("<span>Completed Attempts: 1</span>").submitted, true);
eq("quiz not taken", parseQuizSummary("<span>Completed Attempts: 0</span>").submitted, false);
eq("quiz unknown page", parseQuizSummary("<p>Something else</p>").submitted, null);

print(failed ? `${failed} FAILED` : "all bs.js tests passed");
