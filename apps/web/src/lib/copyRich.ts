// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Copy markdown to the clipboard in two flavors simultaneously:
//   text/html  — rich formatting for Gmail / Outlook / Teams / Word pastes
//   text/plain — the markdown itself for Slack / editors / plain targets
// The receiving app picks whichever it supports. Used for call notes, vault
// notes, and chat replies (a drafted email pasted into a mail composer must
// arrive as paragraphs and bold, not as asterisks and a single run-on line).

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

const CALLOUT_HEAD = /^>?\s*\[!\w+\][+-]?/;

export function notesToHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (kind: "ul" | "ol") => {
    if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
  };
  for (const raw of md.split("\n")) {
    // a callout header ("> [!note] Simplified email") is a label on the
    // block, not part of the email — it does not go into the paste
    if (CALLOUT_HEAD.test(raw)) { closeList(); continue; }
    // quoted lines (an email draft inside a reply) copy as their content
    const line = raw.replace(/^>\s?/, "");
    if (line.trim() === "") { closeList(); continue; }
    const h1 = line.match(/^# (.+)$/);
    if (h1) { closeList(); out.push(`<h2>${inline(h1[1])}</h2>`); continue; }
    const h2 = line.match(/^## (.+)$/);
    if (h2) { closeList(); out.push(`<h3>${inline(h2[1])}</h3>`); continue; }
    const h3 = line.match(/^### (.+)$/);
    if (h3) { closeList(); out.push(`<h4>${inline(h3[1])}</h4>`); continue; }
    const box = line.match(/^- \[( |x)\] (.*)$/);
    if (box) {
      openList("ul");
      out.push(`<li>${box[1] === "x" ? "☑" : "☐"} ${inline(box[2])}</li>`);
      continue;
    }
    const li = line.match(/^\s*[-*] (.*)$/);
    if (li) { openList("ul"); out.push(`<li>${inline(li[1])}</li>`); continue; }
    const ol = line.match(/^\s*\d+[.)] (.*)$/);
    if (ol) { openList("ol"); out.push(`<li>${inline(ol[1])}</li>`); continue; }
    if (/^-{3,}$/.test(line.trim())) { closeList(); out.push("<hr>"); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

/** Plain-text flavor: the markdown with quote markers and callout tags
 *  stripped, so a plain-text target gets clean prose rather than "> " runs. */
export function notesToText(md: string): string {
  return md.split("\n")
    .filter((l) => !CALLOUT_HEAD.test(l))
    .map((l) => l.replace(/^>\s?/, ""))
    .join("\n").trim() + "\n";
}

export async function copyNotes(md: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([notesToHtml(md)], { type: "text/html" }),
        "text/plain": new Blob([notesToText(md)], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(notesToText(md));
      return true;
    } catch {
      return false;
    }
  }
}

export const copyRich = copyNotes;
