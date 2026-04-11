import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { getAgentMemorySnapshot, runAgentWorkflow } from "./lib/agents.js";
import { createJob, getJob } from "./lib/jobs.js";

const app = express();

app.use(express.json());
app.use(express.static("public"));

const agentRunSchema = z.object({
  sessionId: z.string().trim().min(1),
  input: z.string().trim().min(1),
  task: z.enum(["auto", "extraction", "planning", "filtering", "trip_planner"]).optional(),
  items: z.array(z.string().trim().min(1)).max(200).optional(),
  preferences: z.array(z.string().trim().min(1)).max(50).optional()
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true
  });
});

app.post("/api/jobs", (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";

  if (!query) {
    res.status(400).json({
      error: "A query is required."
    });
    return;
  }

  const job = createJob(query);
  res.status(202).json({
    id: job.id
  });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);

  if (!job) {
    res.status(404).json({
      error: "Job not found."
    });
    return;
  }

  res.json(job);
});

app.post("/api/agents/run", async (req, res) => {
  const parsed = agentRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request payload.",
      details: parsed.error.flatten()
    });
    return;
  }

  try {
    const response = await runAgentWorkflow(parsed.data);
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error while running agent workflow."
    });
  }
});

app.get("/api/agents/memory/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId?.trim() ?? "";
  if (!sessionId) {
    res.status(400).json({
      error: "A sessionId path param is required."
    });
    return;
  }

  try {
    const memory = await getAgentMemorySnapshot(sessionId);
    res.status(200).json({
      sessionId,
      ...memory
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error while reading memory."
    });
  }
});

app.listen(config.port, () => {
  console.log(`Leady listening on http://localhost:${config.port}`);
});
