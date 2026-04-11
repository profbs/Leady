import { randomUUID } from "node:crypto";
import type { JobLogEntry, JobState } from "../types.js";
import { runProspectingPipeline } from "./pipeline.js";
import { isoNow } from "./utils.js";

const jobs = new Map<string, JobState>();

export function createJob(query: string): JobState {
  const now = isoNow();
  const job: JobState = {
    id: randomUUID(),
    query,
    status: "queued",
    logs: [],
    createdAt: now,
    updatedAt: now
  };

  jobs.set(job.id, job);
  void runJob(job.id);
  return job;
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

async function runJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) {
    return;
  }

  updateJob(job, {
    status: "running"
  });
  appendLog(job, "Job started.");

  try {
    const result = await runProspectingPipeline(job.query, (message) => {
      appendLog(job, message);
    });

    updateJob(job, {
      status: "completed",
      result
    });
    appendLog(job, "Job completed.");
  } catch (error) {
    updateJob(job, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error"
    });
    appendLog(job, `Job failed: ${job.error}`);
  }
}

function appendLog(job: JobState, message: string): void {
  const entry: JobLogEntry = {
    timestamp: isoNow(),
    message
  };

  job.logs.push(entry);
  job.updatedAt = isoNow();
}

function updateJob(job: JobState, updates: Partial<JobState>): void {
  Object.assign(job, updates);
  job.updatedAt = isoNow();
}
