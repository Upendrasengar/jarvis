// Copy call notes to the clipboard in two flavors simultaneously:
//   text/html  — rich formatting for Teams / Outlook / Word / Gmail pastes
//   text/plain — the markdown itself for Slack / editors / plain targets
// The receiving app picks whichever it supports.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s: string): string {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function notesToHtml(md: string): string {
  const out: string[] = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { out.push("</ul>"); listOpen = false; } };
  for (const line of md.split("\n")) {
    if (line.trim() === "") continue;
    const h1 = line.match(/^# (.+)$/);
    if (h1) { closeList(); out.push(`<h2>${inline(h1[1])}</h2>`); continue; }
    const h2 = line.match(/^## (.+)$/);
    if (h2) { closeList(); out.push(`<h3>${inline(h2[1])}</h3>`); continue; }
    const box = line.match(/^- \[( |x)\] (.*)$/);
    if (box) {
      if (!listOpen) { out.push("<ul>"); listOpen = true; }
      out.push(`<li>${box[1] === "x" ? "☑" : "☐"} ${inline(box[2])}</li>`);
      continue;
    }
    const li = line.match(/^\s*[-*] (.*)$/);
    if (li) {
      if (!listOpen) { out.push("<ul>"); listOpen = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

export async function copyNotes(md: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([notesToHtml(md)], { type: "text/html" }),
        "text/plain": new Blob([md], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(md);
      return true;
    } catch {
      return false;
    }
  }
}
