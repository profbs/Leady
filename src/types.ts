export type EmailSource = "homepage" | "contact page" | "not found";

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
