import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  const origin = getSiteUrl().origin;
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/architect/", "/business/", "/api/", "/magic-link"]
      }
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin
  };
}
