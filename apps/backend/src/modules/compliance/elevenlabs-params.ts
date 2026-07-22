import { env } from "../../config/env";
import { isConfirmed, type WorkspaceGuardConfig } from "./workspace-ai-guard";

export function elevenLabsTtsQuery(
  params: Record<string, string> = {},
  config: WorkspaceGuardConfig = env as unknown as WorkspaceGuardConfig
): string {
  const search = new URLSearchParams(params);
  if (isConfirmed(config["ELEVENLABS_ZRM_CONFIRMED"])) {
    search.set("enable_logging", "false");
  }
  return search.toString();
}
