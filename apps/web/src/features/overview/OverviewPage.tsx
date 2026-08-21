// Command-center overview: daily-moving KPIs (each a door to its tab),
// today's focus from the digest, git activity, live agents + recording,
// today's calls, MCP servers — around the neural-core globe.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import * as S from "@jarvis/shared";
import { NeuralCore } from "./NeuralCore";
import { useCalls, callTitle } from "../calls/hooks";

function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: async () => S.Stats.parse(await (await fetch("/api/stats")).json()),
  });
}
function useLatestDigest() {
  return useQuery({
    queryKey: ["digest", "latest"],
    queryFn: async () => S.Digest.parse(await (await fetch("/api/digest")).json()),
  });
}
function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await fetch("/api/agents")).json() as Promise<any[]>,
    refetchInterval: 8000,
  });
}

function Panel({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 backdrop-blur-lg">
      <h3 className="mb-2 flex justify-between text-[10px] uppercase tracking-[1.5px] text-[var(--cyan)]">
        {title} <span className="text-[var(--dim)]">{tag}</span>
      </h3>
      {children}
    </div>
  );
}

const Row = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
  <div
    onClick={onClick}
    className={`truncate border-b border-dashed border-[rgba(60,140,220,.1)] py-[3px] text-[11px] text-[var(--dim)] ${onClick ? "cursor-pointer hover:text-[var(--cyan)]" : ""}`}
  >
    {children}
  </div>
);

export function OverviewPage() {
  const { data: s } = useStats();
  const { data: calls = [] } = useCalls();
  const { data: dig } = useLatestDigest();
  const { data: agents = [] } = useAgents();
  const navigate = useNavigate();

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todaysCalls = calls.filter((c) => c.id.startsWith(today) && c.status !== "empty");
  const openActions = calls.reduce((n, c) => n + ((c.notes.match(/- \[ \]/g)) ?? []).length, 0);
  const recording = calls.find((c) => c.status === "recording");
  const working = agents.filter((a) => a.status === "working" && !a.silent);

  const focus = ((dig?.md ?? "").split(/## Suggested focuses/i)[1] ?? "").split(/\n## /)[0]
    .split("\n").filter((l) => /^\s*(\d+\.|[-*])\s+/.test(l))
    .map((l) => l.replace(/^\s*(\d+\.|[-*])\s+/, "").replace(/\*\*/g, "").trim()).slice(0, 3);

  const kpis: Array<[string, string | number, string, string]> = [
    ["Active Projects", s?.stats.activeProjects ?? "…", `of ${s?.stats.totalProjects ?? "…"}`, "/projects"],
    ["Commits", s?.stats.commits7d ?? "…", "7 days", "/digest"],
    ["Calls", todaysCalls.length, "today", "/calls"],
    ["Open Actions", openActions, "from calls", "/actions"],
    ["Brain Notes", s?.stats.notes ?? "…", `${s?.stats.links ?? "…"} links`, "/brain"],
    ["MCP", 4, "published", "/projects"],
  ];

  return (
    <div className="grid h-full grid-cols-[300px_1fr_300px] grid-rows-[auto_1fr] gap-3 p-3">
      <div className="col-span-3 grid grid-cols-6 gap-2">
        {kpis.map(([lbl, val, sub, to]) => (
          <button
            key={lbl}
            onClick={() => navigate(to)}
            className="relative overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] p-[10px] text-left transition hover:-translate-y-[2px] hover:border-[rgba(57,215,255,.45)]"
          >
            <div className="text-[9px] uppercase tracking-[1.5px] text-[var(--dim)]">{lbl}</div>
            <div className="mt-[2px] text-xl font-bold text-[var(--bright)]">{val}</div>
            <div className="text-[10px] text-[var(--green)]">{sub}</div>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <Panel title="A-01 · Today's Focus" tag="FROM DIGEST">
          {focus.length
            ? focus.map((f, i) => (
                <Link
                  key={i}
                  to="/digest"
                  className="block whitespace-normal border-b border-dashed border-[rgba(60,140,220,.1)] py-[5px] text-[11px] leading-normal text-[var(--dim)] no-underline hover:text-[var(--text)]"
                >
                  <b className="mr-2 text-[var(--cyan)]">{i + 1}</b>{f}
                </Link>
              ))
            : <Row>No digest yet — ask Jarvis for one.</Row>}
        </Panel>
        <Panel title="A-02 · Recent Git Activity" tag="7D">
          {(s?.activity.length ? s.activity : ["no commits in the last window — quiet repo day"])
            .map((a, i) => <Row key={i}>{a.slice(0, 80)}</Row>)}
        </Panel>
      </div>

      <div className="relative min-h-0">
        <NeuralCore
          status={{
            recording: !!recording,
            processing: calls.some((c) => c.status === "processing"),
            agents: working.length,
          }}
        />
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <Panel title="Z-01 · Live Now" tag={`${working.length}/${agents.length}`}>
          {recording && (
            <div
              onClick={() => navigate(`/calls/${recording.id}`)}
              className="blip mb-2 cursor-pointer rounded-lg border border-[rgba(255,92,122,.4)] bg-[rgba(255,92,122,.08)] px-3 py-2 text-[11px] text-[var(--red)]"
            >
              ● recording a call now — tap to open
            </div>
          )}
          {working.length
            ? working.map((a) => (
                <Row key={a.id}><b className="text-[var(--text)]">{a.project}</b> · {a.task.slice(0, 50)}</Row>
              ))
            : <Row>No active agents. Ask Jarvis to "work on &lt;project&gt;".</Row>}
        </Panel>
        <Panel title="Z-02 · Calls Today" tag={String(todaysCalls.length || "—")}>
          {todaysCalls.length
            ? todaysCalls.slice(0, 5).map((c) => {
                const open = ((c.notes.match(/- \[ \]/g)) ?? []).length;
                return (
                  <Row key={c.id} onClick={() => navigate(`/calls/${c.id}`)}>
                    <b className="text-[var(--text)]">{callTitle(c).slice(0, 34)}</b> · {c.started.slice(11, 16)}
                    {open ? <span className="text-[var(--amber)]"> · {open} open</span> : null}
                  </Row>
                );
              })
            : <Row>No calls captured today.</Row>}
        </Panel>
        <Panel title="Z-03 · MCP Servers" tag="PUBLISHED">
          {["adobe-target-mcp", "jira-dc-mcp", "confluence-dc-mcp", "bitbucket-server-mcp"].map((id) => (
            <Row key={id}>
              <b className="text-[var(--text)]">{id}</b>{" "}
              <span className="rounded-full bg-[rgba(62,224,138,.14)] px-2 text-[9px] text-[var(--green)]">live</span>
            </Row>
          ))}
        </Panel>
      </div>
    </div>
  );
}
