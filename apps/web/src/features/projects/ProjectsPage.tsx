import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as S from "@jarvis/shared";

type Filter = "all" | "active" | "inactive";

export function ProjectsPage() {
  const qc = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => S.Project.array().parse(await (await fetch("/api/projects")).json()),
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const counts = useMemo(
    () => ({
      all: projects.length,
      active: projects.filter((p) => p.status === "active").length,
      inactive: projects.filter((p) => p.status !== "active").length,
    }),
    [projects],
  );
  const needle = q.trim().toLowerCase();
  const visible = projects
    .filter((p) =>
      filter === "all" ? true : filter === "active" ? p.status === "active" : p.status !== "active")
    .filter((p) =>
      !needle ||
      p.id.toLowerCase().includes(needle) ||
      p.category.toLowerCase().includes(needle) ||
      p.what.toLowerCase().includes(needle));

  const toggle = async (p: S.Project) => {
    const status = p.status === "active" ? "inactive" : "active";
    await fetch("/api/projects/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, status }),
    }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["graph"] });
  };

  return (
    <div className="h-full overflow-auto p-5">
      <div className="mb-4 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects…"
          className="w-[220px] rounded-full border border-[var(--line)] bg-[var(--field)] px-3 py-1 font-sans text-[11.5px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--cyan)]"
        />
        {(["all", "active", "inactive"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 font-sans text-[11px] capitalize ${
              filter === f
                ? "border-[rgba(57,215,255,.4)] bg-[rgba(57,215,255,.08)] text-[var(--cyan)]"
                : "border-[var(--line)] text-[var(--dim)] hover:text-[var(--bright)]"
            }`}
          >
            {f} {counts[f]}
          </button>
        ))}
        <span className="ml-auto self-center font-sans text-[10.5px] text-[var(--dim)]">
          {needle ? `${visible.length} match${visible.length === 1 ? "" : "es"}` : "Inactive projects are hidden from the brain graph and skipped by the digest scan."}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {visible.map((p) => {
          const active = p.status === "active";
          return (
            <div
              key={p.id}
              className={`rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 backdrop-blur-lg transition hover:border-[rgba(57,215,255,.4)] ${active ? "" : "opacity-55"}`}
            >
              <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-[var(--cyan)]">
                {p.category || "project"}
                <button
                  onClick={() => toggle(p)}
                  title={active ? "Pause: hide from brain graph and digest scan" : "Reactivate"}
                  className={`ml-2 cursor-pointer rounded-full px-2 py-[1px] text-[9px] transition ${
                    active
                      ? "bg-[rgba(62,224,138,.14)] text-[var(--green)] hover:bg-[rgba(255,92,122,.15)] hover:text-[var(--red)]"
                      : "bg-[rgba(95,137,173,.15)] text-[var(--dim)] hover:bg-[rgba(62,224,138,.15)] hover:text-[var(--green)]"
                  }`}
                >
                  {active ? "active" : "inactive"}
                </button>
              </div>
              <h4 className="mb-1 font-sans text-[13px] font-semibold text-[var(--bright)]">{p.id}</h4>
              <div className="font-sans text-[11px] text-[var(--dim)]">{p.what}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
