import type { MetadataRoute } from "next";

import { legalDocuments, sitePages } from "@/lib/site";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * The public sitemap.
 *
 * Built from the same two lists the footer and the legal sidebar use, so a page cannot be
 * added to the navigation and forgotten here. Admin, API and auth routes are deliberately
 * absent - they are not public content, and their absence is intentional rather than an
 * omission.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [...sitePages, ...legalDocuments].map((page) => ({
    url: `${baseUrl}${page.href === "/" ? "" : page.href}`,
    lastModified,
    changeFrequency: "monthly" as const,
    priority: page.href === "/" ? 1 : 0.6,
  }));
}
