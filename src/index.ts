import express from "express";
import { config } from "./config.js";
import { createJob, getJob } from "./lib/jobs.js";

const app = express();

app.use(express.json());
app.use(express.static("public"));

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

app.listen(config.port, () => {
  console.log(`Leady listening on http://localhost:${config.port}`);
});
