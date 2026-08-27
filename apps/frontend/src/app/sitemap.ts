import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-metadata";

const PUBLIC_PATHS = [
  "/",
  "/marketplace",
  "/pricing",
  "/about",
  "/contact",
  "/contactus",
  "/resources",
  "/resources/architect",
  "/assignment",
  "/privacy",
  "/terms",
  "/security",
  "/DPA",
  "/sms-consent",
  "/data-deletion",
  "/architect/login",
  "/architect/signup",
  "/business/login",
  "/business/signup"
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getSiteUrl().origin;
  const lastModified = new Date();
  return PUBLIC_PATHS.map((path) => ({
    url: path === "/" ? origin : `${origin}${path}`,
    lastModified,
    changeFrequency: path === "/" || path === "/marketplace" ? "daily" : "weekly",
    priority: path === "/" ? 1 : path === "/marketplace" || path === "/pricing" ? 0.9 : 0.6
  }));
}
