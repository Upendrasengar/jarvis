import { Navigate, Route, Routes } from "react-router-dom";
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

export function AppRoutes() {
  return (
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
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:id" element={<NotesPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}
