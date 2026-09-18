// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Where things actually live, resolved at runtime.
//
// CALL_NOTES_DIR is the vault's Calls/ folder in vault mode and reports/ in
// legacy mode. Nothing told the models that, so both fell back on CLAUDE.md,
// which still documents the pre-vault layout — and a worker asked about a call
// dutifully grepped reports/call-notes-*.md, found the 0 files that are there,
// and reported that nothing existed while 122 notes sat in the vault.
//
// Prose in a manual cannot track a runtime branch. These paths are computed
// from the same config the code uses, so they cannot drift from it, and the
// counts make an empty directory obvious instead of silently plausible.
import fs from "node:fs";
import path from "node:path";
import { BRAIN_DIR, CALL_NOTES_DIR, CALLS_DIR, DIGESTS_DIR, VAULT_DIR } from "../config.js";

const count = (dir: string, suffix = ".md") => {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).length; }
  catch { return 0; }
};

export function whereThingsAre(): string {
  const notes = path.join(BRAIN_DIR, "Notes");
  const topics = path.join(BRAIN_DIR, "Topics");
  const lines = [
    "WHERE THINGS ARE (resolved live — trust these over any path written in a doc):",
    `  call notes    ${CALL_NOTES_DIR}  (${count(CALL_NOTES_DIR)} files)`,
    `  notes         ${notes}  (${count(notes)} files)`,
    `  topic hubs    ${topics}  (${count(topics)} files)`,
    `  digests       ${DIGESTS_DIR}  (${count(DIGESTS_DIR)} files)`,
    `  raw recordings + transcripts  ${CALLS_DIR}/<stamp>/transcript.md`,
  ];
  if (VAULT_DIR)
    lines.push(
      "  This install is in VAULT mode. reports/call-notes-*.md does NOT exist here —",
      "  do not search it, and do not report 'nothing found' on the strength of it.",
    );
  return lines.join("\n");
}
