import { config } from "../config.js";
import type { AgentMemoryEntry } from "../types.js";
import { getCacheStore, getCacheStoreKind } from "./cache.js";

function buildMemoryKey(sessionId: string): string {
  return `agent-memory:${sessionId.trim().toLowerCase()}`;
}

export async function getAgentMemory(sessionId: string): Promise<{
  entries: AgentMemoryEntry[];
  store: "redis" | "memory";
}> {
  const cache = await getCacheStore();
  const entries = (await cache.get<AgentMemoryEntry[]>(buildMemoryKey(sessionId))) ?? [];

  return {
    entries,
    store: getCacheStoreKind() ?? "memory"
  };
}

export async function appendAgentMemory(sessionId: string, entries: AgentMemoryEntry[]): Promise<void> {
  const cache = await getCacheStore();
  const key = buildMemoryKey(sessionId);
  const existing = (await cache.get<AgentMemoryEntry[]>(key)) ?? [];
  const merged = [...existing, ...entries].slice(-config.agentMemoryMaxEntries);

  await cache.set(key, merged, config.agentMemoryTtlSeconds);
}
