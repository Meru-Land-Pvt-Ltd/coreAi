import type { NodeAccent } from "./types";

export const nodeIconAccent: Record<string, NodeAccent> = {
  phone: "amber",
  sparkles: "violet",
  diamond: "orange",
  message: "green",
  whatsapp: "green",
  mail: "blue",
  capture: "blue",
  database: "violet"
};

export function getIconAccent(icon: string): NodeAccent {
  return nodeIconAccent[icon] ?? "slate";
}
