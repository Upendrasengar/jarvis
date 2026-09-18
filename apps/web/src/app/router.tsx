// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Layout } from "./Layout";
import { CallsPage } from "../features/calls/CallsPage";
import { ActionsPage } from "../features/actions/ActionsPage";
import { ChatPage } from "../features/chat/ChatPage";
import { DigestPage } from "../features/digest/DigestPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { BrainPage } from "../features/brain/BrainPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { LogsPage } from "../features/logs/LogsPage";
import { NotesPage } from "../features/notes/NotesPage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";

// The window title is how this app is identified in Mission Control, cmd-tab
// and the Window menu. Nothing set a per-view title, so every route read
// "J.A.R.V.I.S" and three open windows were indistinguishable.
const TITLES: Record<string, string> = {
  overview: "Overview", chat: "Chat", brain: "Brain", projects: "Projects",
  calls: "Calls", actions: "Actions", digest: "Digest", settings: "Settings",
  logs: "Activity", notes: "Notes", onboarding: "Setup",
};

function PageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const section = TITLES[pathname.split("/")[1] ?? ""];
    document.title = section ? `Jarvis — ${section}` : "J.A.R.V.I.S";
  }, [pathname]);
  return null;
}

// A fresh install should land in setup; an established one never should.
//
// The gate consults setupComplete, which counts only REQUIRED steps — if an
// optional integration counted, declining the calendar would bounce you back
// into onboarding on every launch with no way out. It also only ever redirects
// from the landing route: navigating anywhere deliberately is never overridden,
// so setup can be left at any point without a fight.
function SetupGate() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data } = useQuery<{ setupComplete: boolean }>({
    queryKey: ["onboarding"],
    queryFn: async () => (await fetch("/api/onboarding")).json(),
    staleTime: 60_000,
    retry: false,          // a server that cannot answer must not strand anyone
  });
  useEffect(() => {
    if (!data || data.setupComplete) return;
    if (pathname === "/" || pathname === "/overview") navigate("/onboarding", { replace: true });
  }, [data, pathname, navigate]);
  return null;
}

export function AppRoutes() {
  return (
    <>
      <PageTitle />
      <SetupGate />
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:id" element={<ChatPage />} />
        <Route path="/brain" element={<BrainPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/calls" element={<CallsPage />} />
        <Route path="/calls/:id" element={<CallsPage />} />
        <Route path="/actions" element={<ActionsPage />} />
        <Route path="/digest" element={<DigestPage />} />
        <Route path="/digest/:date" element={<DigestPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:id" element={<NotesPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
    </>
  );
}
