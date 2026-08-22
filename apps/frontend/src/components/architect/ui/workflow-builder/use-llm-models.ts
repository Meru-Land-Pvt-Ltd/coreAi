"use client";

/**
 * THE MODEL LIST, AS THE PLATFORM HAS IT RIGHT NOW.
 *
 * The builder used to read a list compiled into its own bundle, so a model an
 * admin added was invisible until the next frontend release — which made
 * "admins can add a model" true on the server and false on the screen.
 *
 * This asks the server once per builder session and falls back to the bundled
 * list if anything goes wrong. An empty model dropdown on a node somebody is
 * halfway through building is far worse than a list one release out of date.
 */

import { useEffect, useState } from "react";
import { LLM_MODELS, type LlmModelMeta } from "@coreai/shared";
import { apiGet } from "@/lib/api";

let cached: LlmModelMeta[] | null = null;
let inFlight: Promise<LlmModelMeta[]> | null = null;

async function fetchModels(): Promise<LlmModelMeta[]> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = apiGet<{ models: LlmModelMeta[] }>("/architect/llm-models")
    .then((response) => {
      const models = response.success ? response.data?.models : undefined;
      // A truthful empty list and a failed call look the same from here, so a
      // list with nothing in it is treated as a failure — the shipped models
      // are always a better answer than none.
      cached = Array.isArray(models) && models.length > 0 ? models : LLM_MODELS;
      return cached;
    })
    .catch(() => LLM_MODELS)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function useLlmModels(): LlmModelMeta[] {
  const [models, setModels] = useState<LlmModelMeta[]>(cached ?? LLM_MODELS);

  useEffect(() => {
    let alive = true;
    void fetchModels().then((next) => {
      if (alive) setModels(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return models;
}

/** Models for one provider, from whatever list the caller is holding. */
export function modelsForProvider(models: LlmModelMeta[], providerId: string): LlmModelMeta[] {
  return models.filter((model) => model.providerId === providerId);
}
