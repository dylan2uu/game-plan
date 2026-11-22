/* Shared matching rules (background + return page). A pattern is "host" or "host/path-prefix". */
export function norm(url) {
  try { const u = new URL(url); return (u.hostname.replace(/^(www\.|m\.)/, "") + u.pathname + u.search).toLowerCase(); }
  catch { return ""; }
}
export function matches(n, pat) {
  if (!n || !pat) return false;
  const i = pat.indexOf("/"), ph = i < 0 ? pat : pat.slice(0, i), pp = i < 0 ? "" : pat.slice(i);
  const j = n.indexOf("/"), host = j < 0 ? n : n.slice(0, j), path = j < 0 ? "/" : n.slice(j);
  if (!(host === ph || host.endsWith("." + ph))) return false;
  return !pp || path.startsWith(pp);
}
export function patternFor(url) {         // what "allow this" means: the page's host + path (no query for most sites)
  const n = norm(url), q = n.indexOf("?");
  if (/^youtube\.com\/watch/.test(n)) return n;         // a specific class video, query and all
  return q < 0 ? n : n.slice(0, q);
}
export function isProtecting(st, now = Date.now()) {
  const s = st && st.session;
  return !!(s && s.state === "active" && s.protectUntil && new Date(s.protectUntil) > now);
}

/* "Open the prompt and jot the questions" → "opening the prompt and jotting the questions" */
const VERBS = new Set(["open", "write", "jot", "read", "draft", "list", "outline", "get", "finish", "review", "take", "make", "figure", "submit",
  "capture", "post", "reply", "check", "do", "find", "skim", "pick", "look", "start", "fix", "run", "test", "edit", "plan", "copy", "note", "answer",
  "watch", "study", "solve", "practice", "build", "add", "send", "email", "set", "go", "sketch", "brainstorm", "type", "record", "polish", "proofread"]);
function ing(v) {
  const w = v.toLowerCase();
  if (w === "do" || w === "go") return w + "ing";
  if (/ie$/.test(w)) return w.slice(0, -2) + "ying";
  if (/[^aeiou]e$/.test(w) && w !== "be") return w.slice(0, -1) + "ing";
  if (/^(jot|get|set|run|plan|submit|stop|sit|put|cut|swap|drop|grab|chat|fix?)$/.test(w) && w !== "fix") return w + w.slice(-1) + "ing";
  return w + "ing";
}
export function gerund(step) {
  let s = String(step || "").trim().replace(/^([^:>]{2,40}>\s*)+[^:]{2,80}:\s*/, "").replace(/[.!]$/, "");
  if (!s) return "";
  const words = s.split(" ");
  const conv = (i) => { if (words[i] && VERBS.has(words[i].toLowerCase())) words[i] = ing(words[i]); };
  conv(0);
  words.forEach((w, i) => { if (/^(and|then|,)$/i.test(w)) conv(i + 1); });
  words[0] = words[0].charAt(0).toLowerCase() + words[0].slice(1);
  return VERBS.has(s.split(" ")[0].toLowerCase()) ? words.join(" ") : "working on: " + s;
}
