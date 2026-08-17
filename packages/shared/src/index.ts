// @jarvis/shared — the API contract. Server routes validate against these
// schemas; the web app imports the inferred types. One source of truth so
// frontend and backend cannot drift.
import { z } from "zod";

export const CallStatus = z.enum(["recording", "processing", "done", "failed", "empty"]);
export type CallStatus = z.infer<typeof CallStatus>;

export const Call = z.object({
  id: z.string(),
  url: z.string(),
  started: z.string(),
  ended: z.string(),
  status: CallStatus,
  notes: z.string(),
  transcript: z.string(),
});
export type Call = z.infer<typeof Call>;

export const RecState = z.union([
  z.object({ recording: z.literal(true), id: z.string(), started: z.string() }),
  z.object({ recording: z.literal(false) }),
]);
export type RecState = z.infer<typeof RecState>;

export const DigestEntry = z.object({ date: z.string() });
export type DigestEntry = z.infer<typeof DigestEntry>;

export const Digest = z.object({ md: z.string() });
export type Digest = z.infer<typeof Digest>;

export const Project = z.object({
  id: z.string(),
  category: z.string(),
  status: z.string(),
  what: z.string(),
});
export type Project = z.infer<typeof Project>;

export const GraphNode = z.object({
  id: z.string(),
  group: z.union([z.string(), z.number()]),
  path: z.string().optional(),
  deg: z.number(),
});
export const GraphLink = z.object({ source: z.string(), target: z.string() });
export const Graph = z.object({ nodes: z.array(GraphNode), links: z.array(GraphLink) });
export type Graph = z.infer<typeof Graph>;

export const Stats = z.object({
  stats: z.object({
    activeProjects: z.number(),
    totalProjects: z.number(),
    notes: z.number(),
    links: z.number(),
    commits7d: z.number(),
    mcpServers: z.number(),
    vaults: z.number(),
  }),
  categories: z.record(z.string(), z.number()),
  activity: z.array(z.string()),
  topNodes: z.array(z.object({ id: z.string(), deg: z.number(), group: z.union([z.string(), z.number()]) })),
  mcp: z.array(z.object({ id: z.string(), status: z.string() })),
});
export type Stats = z.infer<typeof Stats>;

export const Autorecord = z.object({ on: z.boolean() });
export type Autorecord = z.infer<typeof Autorecord>;

export const ToggleCallItemBody = z.object({ id: z.string().regex(/^[\w-]+$/), index: z.number().int().min(0) });
export const UpdateNotesBody = z.object({
  id: z.string().regex(/^[\w-]+$/),
  notes: z.string().min(1).max(200_000),
});
export const DeleteCallBody = z.object({ id: z.string().regex(/^[\w-]+$/) });
export const AutorecordBody = z.object({ on: z.boolean() });

// Actions inbox — every "- [ ] Owner: task" across all call notes, indexed.
export const ActionItem = z.object({
  callId: z.string(),
  index: z.number().int(),        // checkbox position within the notes file
  owner: z.string(),              // "Me", a name, "Unassigned", or "" for old notes
  text: z.string(),
  done: z.boolean(),
  callTitle: z.string(),
  callStarted: z.string(),
  comments: z.array(z.string()),
});
export type ActionItem = z.infer<typeof ActionItem>;

export const ToggleActionBody = z.object({
  callId: z.string().regex(/^(note:)?[\w-]+$/),
  index: z.number().int().min(0),
});
export const CommentActionBody = z.object({
  callId: z.string().regex(/^(note:)?[\w-]+$/),
  index: z.number().int().min(0),
  text: z.string().min(1).max(500),
});

// Live channel messages (WebSocket /api/live)
export const LiveMessage = z.object({ type: z.enum(["hello", "fs"]), at: z.number() });
export type LiveMessage = z.infer<typeof LiveMessage>;

// Settings (⚙ page). Secrets (API keys) are NOT here — they live only in
// the gitignored secrets/.env.
export const VoiceMode = z.enum(["on-demand", "wake-word", "conversation"]);
export type VoiceMode = z.infer<typeof VoiceMode>;

export const Settings = z.object({
  voiceMode: VoiceMode,
  autorecord: z.boolean(),
  whisperModel: z.enum(["small", "medium"]),
  retentionDays: z.number().int().min(1).max(90),
  voice: z.string(),   // ElevenLabs preset name (or raw id)
});
export type Settings = z.infer<typeof Settings>;
export const SettingsPatch = Settings.partial();

export const NoteMeta = z.object({
  id: z.string(),
  title: z.string(),
  updated: z.number(),
  call: z.string(),
  preview: z.string(),
  openItems: z.number(),
});
export type NoteMeta = z.infer<typeof NoteMeta>;

export const VoicesInfo = z.object({ current: z.string(), presets: z.array(z.string()) });
export type VoicesInfo = z.infer<typeof VoicesInfo>;

export const Ok = z.object({ ok: z.literal(true) });
export const Err = z.object({ error: z.string() });
