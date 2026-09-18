// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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

export function AppRoutes() {
  return (
    <>
      <PageTitle />
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
