import type { NodeAccent } from "./types";

export const nodeIconAccent: Record<string, NodeAccent> = {
  phone: "amber",
  sparkles: "violet",
  diamond: "orange",
  message: "green",
  mail: "blue",
  capture: "blue"
};

export function getIconAccent(icon: string): NodeAccent {
  return nodeIconAccent[icon] ?? "slate";
}
