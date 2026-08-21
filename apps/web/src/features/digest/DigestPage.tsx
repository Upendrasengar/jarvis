// Digest history browser — date sidebar + reading pane, deep-linked at
// /digest/:date.
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as S from "@jarvis/shared";
import { Markdown } from "../../components/Markdown";

// Check an item off WITHOUT leaving the digest: find the matching action in
// the source call/note (same normalization the ledger used) and toggle it.
// The digest file itself is a snapshot — tomorrow's ledger drops the item.
async function ledgerToggle(source: string, line: string): Promise<boolean> {
  try {
    const actions = await (await fetch("/api/actions")).json();
    const callId = source.startsWith("call-notes-")
      ? source.replace(/^call-notes-/, "").replace(/\.md$/, "")
      : "note:" + source.replace(/\.md$/, "");
    const norm = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const L = norm(line);
    const cands = actions.filter(
      (a: any) => a.callId === callId && a.text && L.includes(norm(a.text)),
    );
    const hit =
      cands.length === 1
        ? cands[0]
        : cands.find((a: any) => L === norm(`${a.owner}: ${a.text}`)) ?? cands[0];
    if (!hit) return false;
    const r = await fetch("/api/actions/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: hit.callId, index: hit.index }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function useDigests() {
  return useQuery({
    queryKey: ["digests"],
    queryFn: async () => S.DigestEntry.array().parse(await (await fetch("/api/digests")).json()),
  });
}

function useDigest(date: string | null) {
  return useQuery({
    queryKey: ["digest", date],
    enabled: !!date,
    queryFn: async () =>
      S.Digest.parse(await (await fetch(`/api/digest?date=${date}`)).json()),
  });
}

export function DigestPage() {
  const { data: list = [] } = useDigests();
  const { date } = useParams();
  const navigate = useNavigate();
  const selected = list.find((d) => d.date === date)?.date ?? list[0]?.date ?? null;
  const { data: digest } = useDigest(selected);

  useEffect(() => {
    if (selected && selected !== date) navigate(`/digest/${selected}`, { replace: true });
  }, [selected, date]);

  let lastMonth = "";
  return (
    <div className="flex h-full">
      <aside className="w-[280px] min-w-[280px] overflow-auto border-r border-[var(--line)] bg-[var(--chipbg)] p-3 backdrop-blur-lg">
        {list.map((d) => {
          const month = d.date.slice(0, 7);
          const header = month !== lastMonth ? (lastMonth = month) : null;
          const latest = d.date === list[0]?.date;
          return (
            <div key={d.date}>
              {header && (
                <div className="mx-1 mb-1 mt-3 text-[9px] uppercase tracking-[2px] text-[var(--dim)]">
                  {header}
                </div>
              )}
              <button
                onClick={() => navigate(`/digest/${d.date}`)}
                className={`mb-[3px] w-full rounded-lg border px-3 py-2 text-left transition ${
                  d.date === selected
                    ? "border-[rgba(57,215,255,.35)] bg-[rgba(57,215,255,.08)]"
                    : "border-transparent hover:bg-[rgba(57,215,255,.05)]"
                }`}
              >
                <div className="font-sans text-xs font-semibold text-[var(--bright)]">
                  {DAYS[new Date(d.date + "T12:00:00").getDay()]} · {d.date}
                </div>
                <div className="mt-[2px] flex items-center gap-2 text-[10px] text-[var(--dim)]">
                  {latest && <span className="h-[7px] w-[7px] rounded-full bg-[var(--green)]" />}
                  {latest ? "latest" : "daily digest"}
                </div>
              </button>
            </div>
          );
        })}
      </aside>
      <section className="min-w-0 flex-1 overflow-auto px-10 py-8">
        {digest ? <Markdown md={digest.md} onLedgerToggle={ledgerToggle} /> : (
          <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>
        )}
      </section>
    </div>
  );
}
