export type EmailSource = "homepage" | "contact page" | "site crawl" | "not found";

export interface ParsedQuery {
  rawQuery: string;
  category: string;
  location: string;
  includedType?: string;
}

export interface BusinessCandidate {
  id: string;
  name: string;
  address: string;
  website?: string;
  phone?: string;
}

export interface PageDocument {
  url: string;
  html: string;
  source: Exclude<EmailSource, "not found">;
}

export interface ExtractionResult {
  email: string | null;
  confidence: number;
  rationale: string;
}

export interface LeadRow {
  businessName: string;
  address: string;
  website: string;
  phone: string;
  contactEmail: string;
  emailSource: EmailSource;
  confidence: number;
}

export interface PipelineStats {
  query: ParsedQuery;
  totalBusinesses: number;
  emailsFound: number;
  runtimeMs: number;
  sheetUrl: string;
  sheetName: string;
}

export interface PipelineResult {
  rows: LeadRow[];
  stats: PipelineStats;
}

export type SpecialistAgentName = "extraction" | "planning" | "filtering" | "trip_planner";

export interface AgentDecision {
  agent: SpecialistAgentName;
  reason: string;
}

export interface AgentMemoryEntry {
  role: "user" | "assistant";
  agent: "master" | SpecialistAgentName;
  content: string;
  timestamp: string;
}

export interface AgentMemorySnapshot {
  store: "redis" | "memory";
  entries: AgentMemoryEntry[];
}

export interface AgentRunRequest {
  sessionId: string;
  input: string;
  task?: "auto" | SpecialistAgentName;
  items?: string[];
  preferences?: string[];
}

export interface AgentRunResponse {
  sessionId: string;
  decision: AgentDecision;
  result: {
    summary: string;
    [key: string]: unknown;
  };
  memory: AgentMemorySnapshot;
}

export interface JobLogEntry {
  timestamp: string;
  message: string;
}

export interface JobState {
  id: string;
  query: string;
  status: "queued" | "running" | "completed" | "failed";
  logs: JobLogEntry[];
  result?: PipelineResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
