import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import type {
  AgentDecision,
  AgentMemoryEntry,
  AgentRunRequest,
  AgentRunResponse,
  SpecialistAgentName
} from "../types.js";
import { appendAgentMemory, getAgentMemory } from "./agentMemory.js";
import { isoNow } from "./utils.js";

const specialistAgents = ["extraction", "planning", "filtering", "trip_planner"] as const;

const masterDecisionSchema = z.object({
  agent: z.enum(specialistAgents),
  reason: z.string()
});

const extractionSchema = z.object({
  summary: z.string(),
  extracted: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      confidence: z.number().min(0).max(1)
    })
  ),
  missingInfo: z.array(z.string())
});

const planningSchema = z.object({
  summary: z.string(),
  goal: z.string(),
  steps: z.array(z.string()).min(1),
  risks: z.array(z.string())
});

const filteringSchema = z.object({
  summary: z.string(),
  criteria: z.array(z.string()),
  kept: z.array(
    z.object({
      item: z.string(),
      reason: z.string()
    })
  ),
  filteredOut: z.array(
    z.object({
      item: z.string(),
      reason: z.string()
    })
  )
});

const tripPlanSchema = z.object({
  summary: z.string(),
  destination: z.string(),
  durationDays: z.number().int().positive(),
  assumptions: z.array(z.string()),
  itinerary: z.array(
    z.object({
      day: z.number().int().positive(),
      title: z.string(),
      activities: z.array(z.string()).min(1)
    })
  )
});

let openAiClient: OpenAI | null = null;

export async function runAgentWorkflow(request: AgentRunRequest): Promise<AgentRunResponse> {
  const memory = await getAgentMemory(request.sessionId);
  const decision = await decideSpecialistAgent(request, memory.entries);
  const result = await runSpecialistAgent(decision.agent, request, memory.entries);

  const memoryEntries: AgentMemoryEntry[] = [
    {
      role: "user",
      content: request.input,
      agent: "master",
      timestamp: isoNow()
    },
    {
      role: "assistant",
      content: JSON.stringify({
        agent: decision.agent,
        summary: result.summary
      }),
      agent: decision.agent,
      timestamp: isoNow()
    }
  ];

  await appendAgentMemory(request.sessionId, memoryEntries);

  const updatedMemory = await getAgentMemory(request.sessionId);
  return {
    sessionId: request.sessionId,
    decision,
    result,
    memory: {
      store: updatedMemory.store,
      entries: updatedMemory.entries
    }
  };
}

export async function getAgentMemorySnapshot(sessionId: string): Promise<AgentRunResponse["memory"]> {
  return getAgentMemory(sessionId);
}

export function selectSpecialistAgentHeuristically(request: AgentRunRequest): AgentDecision {
  if (request.task && request.task !== "auto") {
    return {
      agent: request.task,
      reason: "The caller explicitly selected this specialist agent."
    };
  }

  const haystack = [request.input, ...(request.items ?? []), ...(request.preferences ?? [])]
    .join(" ")
    .toLowerCase();

  if (/(trip|itinerary|travel|vacation|visit|city break|day-by-day)/.test(haystack)) {
    return {
      agent: "trip_planner",
      reason: "The request is asking for travel planning or an itinerary."
    };
  }

  if ((request.items?.length ?? 0) > 0 || /(filter|remove|exclude|shortlist|narrow|screen)/.test(haystack)) {
    return {
      agent: "filtering",
      reason: "The request includes items or language about narrowing a list."
    };
  }

  if (/(extract|pull out|find|parse|identify|entities|requirements|facts|emails?)/.test(haystack)) {
    return {
      agent: "extraction",
      reason: "The request is focused on pulling structured information out of content."
    };
  }

  return {
    agent: "planning",
    reason: "The request is best handled as structured planning by default."
  };
}

async function decideSpecialistAgent(
  request: AgentRunRequest,
  memoryEntries: AgentMemoryEntry[]
): Promise<AgentDecision> {
  const heuristic = selectSpecialistAgentHeuristically(request);

  if (!config.openAiApiKey) {
    return heuristic;
  }

  try {
    const client = getOpenAiClient();
    const response = await client.responses.parse({
      model: config.openAiModel,
      instructions:
        "You are a master routing agent. Choose exactly one specialist agent: extraction, planning, filtering, or trip_planner. Use extraction for pulling structured facts, planning for step-by-step execution plans, filtering for deciding what to keep or remove from a set, and trip_planner for travel itineraries.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildRoutingPrompt(request, memoryEntries, heuristic)
            }
          ]
        }
      ],
      text: {
        format: zodTextFormat(masterDecisionSchema, "master_decision")
      }
    });

    return response.output_parsed ?? heuristic;
  } catch {
    return heuristic;
  }
}

async function runSpecialistAgent(
  agent: SpecialistAgentName,
  request: AgentRunRequest,
  memoryEntries: AgentMemoryEntry[]
): Promise<AgentRunResponse["result"]> {
  switch (agent) {
    case "extraction":
      return runExtractionAgent(request, memoryEntries);
    case "planning":
      return runPlanningAgent(request, memoryEntries);
    case "filtering":
      return runFilteringAgent(request, memoryEntries);
    case "trip_planner":
      return runTripPlannerAgent(request, memoryEntries);
  }
}

async function runExtractionAgent(
  request: AgentRunRequest,
  memoryEntries: AgentMemoryEntry[]
): Promise<AgentRunResponse["result"]> {
  if (!config.openAiApiKey) {
    const extracted = parseListFromInput(request.input).map((value) => ({
      label: "item",
      value,
      confidence: 0.45
    }));

    return {
      summary: extracted.length > 0 ? "Extracted structured items with heuristic parsing." : "No obvious structured items were found.",
      extracted,
      missingInfo: extracted.length > 0 ? [] : ["More explicit extraction instructions would help."]
    };
  }

  const response = await getOpenAiClient().responses.parse({
    model: config.openAiModel,
    instructions:
      "You are an extraction specialist. Pull out the most useful structured facts from the request and memory. Return concise normalized values only.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildSpecialistPrompt("extraction", request, memoryEntries)
          }
        ]
      }
    ],
    text: {
      format: zodTextFormat(extractionSchema, "extraction_result")
    }
  });

  return response.output_parsed ?? {
    summary: "The extraction agent could not parse a structured response.",
    extracted: [],
    missingInfo: ["Retry with more explicit data to extract."]
  };
}

async function runPlanningAgent(
  request: AgentRunRequest,
  memoryEntries: AgentMemoryEntry[]
): Promise<AgentRunResponse["result"]> {
  if (!config.openAiApiKey) {
    return {
      summary: "Built a simple plan with a heuristic fallback.",
      goal: request.input,
      steps: [
        "Clarify the final outcome and constraints.",
        "Gather the inputs and dependencies.",
        "Execute the work in a few verifiable stages.",
        "Review the result and adjust based on feedback."
      ],
      risks: ["Some assumptions may be missing because no model reasoning was available."]
    };
  }

  const response = await getOpenAiClient().responses.parse({
    model: config.openAiModel,
    instructions:
      "You are a planning specialist. Create an actionable plan with concrete steps, likely risks, and a short summary.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildSpecialistPrompt("planning", request, memoryEntries)
          }
        ]
      }
    ],
    text: {
      format: zodTextFormat(planningSchema, "planning_result")
    }
  });

  return response.output_parsed ?? {
    summary: "The planning agent could not parse a structured response.",
    goal: request.input,
    steps: ["Retry with more concrete constraints."],
    risks: ["The model response was not parseable."]
  };
}

async function runFilteringAgent(
  request: AgentRunRequest,
  memoryEntries: AgentMemoryEntry[]
): Promise<AgentRunResponse["result"]> {
  const items = request.items && request.items.length > 0 ? request.items : parseListFromInput(request.input);

  if (!config.openAiApiKey) {
    return {
      summary: `Heuristically kept ${items.length} items because no model-based filter was available.`,
      criteria: request.preferences ?? [],
      kept: items.map((item) => ({ item, reason: "No filtering model was available, so the item was retained." })),
      filteredOut: []
    };
  }

  const response = await getOpenAiClient().responses.parse({
    model: config.openAiModel,
    instructions:
      "You are a filtering specialist. Decide what to keep and what to remove based on the user request, provided items, preferences, and memory. Explain each decision briefly.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildSpecialistPrompt("filtering", { ...request, items }, memoryEntries)
          }
        ]
      }
    ],
    text: {
      format: zodTextFormat(filteringSchema, "filtering_result")
    }
  });

  return response.output_parsed ?? {
    summary: "The filtering agent could not parse a structured response.",
    criteria: request.preferences ?? [],
    kept: items.map((item) => ({ item, reason: "Fallback keep due to parse failure." })),
    filteredOut: []
  };
}

async function runTripPlannerAgent(
  request: AgentRunRequest,
  memoryEntries: AgentMemoryEntry[]
): Promise<AgentRunResponse["result"]> {
  if (!config.openAiApiKey) {
    return {
      summary: "Built a compact trip outline with a heuristic fallback.",
      destination: guessDestination(request.input),
      durationDays: 3,
      assumptions: ["Dates and budget were not provided."],
      itinerary: [
        { day: 1, title: "Arrival and neighborhood walk", activities: ["Check in", "Explore the local area", "Have a relaxed dinner"] },
        { day: 2, title: "Core highlights", activities: ["Visit the main sights", "Leave time for one reservation", "Keep the evening flexible"] },
        { day: 3, title: "Final favorites and departure", activities: ["Revisit a favorite area", "Pick up anything you missed", "Head to departure"] }
      ]
    };
  }

  const response = await getOpenAiClient().responses.parse({
    model: config.openAiModel,
    instructions:
      "You are a trip-planning specialist. Build a realistic trip plan using the request, stated preferences, and stored memory. Keep it practical and easy to follow.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildSpecialistPrompt("trip_planner", request, memoryEntries)
          }
        ]
      }
    ],
    text: {
      format: zodTextFormat(tripPlanSchema, "trip_plan_result")
    }
  });

  return response.output_parsed ?? {
    summary: "The trip planner could not parse a structured response.",
    destination: guessDestination(request.input),
    durationDays: 3,
    assumptions: ["The model response was not parseable."],
    itinerary: [
      { day: 1, title: "Arrival", activities: ["Settle in and orient yourself"] },
      { day: 2, title: "Explore", activities: ["Visit key highlights"] },
      { day: 3, title: "Wrap up", activities: ["Leave time for a final flexible activity"] }
    ]
  };
}

function getOpenAiClient(): OpenAI {
  if (!openAiClient) {
    openAiClient = new OpenAI({
      apiKey: config.openAiApiKey
    });
  }

  return openAiClient;
}

function buildRoutingPrompt(
  request: AgentRunRequest,
  memoryEntries: AgentMemoryEntry[],
  heuristic: AgentDecision
): string {
  return [
    `Session: ${request.sessionId}`,
    `Requested task override: ${request.task ?? "auto"}`,
    `Current input: ${request.input}`,
    request.items && request.items.length > 0 ? `Items: ${request.items.join(" | ")}` : "Items: none",
    request.preferences && request.preferences.length > 0
      ? `Preferences: ${request.preferences.join(" | ")}`
      : "Preferences: none",
    `Recent memory:\n${formatMemoryEntries(memoryEntries)}`,
    `Heuristic choice: ${heuristic.agent}`,
    `Heuristic reason: ${heuristic.reason}`
  ].join("\n\n");
}

function buildSpecialistPrompt(
  agent: SpecialistAgentName,
  request: AgentRunRequest,
  memoryEntries: AgentMemoryEntry[]
): string {
  return [
    `Specialist agent: ${agent}`,
    `Session: ${request.sessionId}`,
    `Input: ${request.input}`,
    request.items && request.items.length > 0 ? `Items:\n- ${request.items.join("\n- ")}` : "Items: none",
    request.preferences && request.preferences.length > 0
      ? `Preferences:\n- ${request.preferences.join("\n- ")}`
      : "Preferences: none",
    `Recent memory:\n${formatMemoryEntries(memoryEntries)}`
  ].join("\n\n");
}

function formatMemoryEntries(entries: AgentMemoryEntry[]): string {
  if (entries.length === 0) {
    return "No prior memory.";
  }

  return entries
    .slice(-8)
    .map((entry) => `[${entry.timestamp}] ${entry.role}/${entry.agent}: ${entry.content}`)
    .join("\n");
}

function parseListFromInput(input: string): string[] {
  return input
    .split(/\n|,|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function guessDestination(input: string): string {
  const match = input.match(/in\s+([A-Z][a-zA-Z\s-]+)/);
  return match?.[1]?.trim() ?? "Unknown destination";
}
