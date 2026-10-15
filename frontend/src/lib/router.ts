/**
 * Minimal hash router. Every view is a shareable link, e.g.
 * #/calls/booking-false-confirmation?tab=trace&event=3
 */
import { useEffect, useState } from "react";

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/calls";
  const [p = "", q = ""] = raw.split("?");
  return { path: p.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function href(path: string[], query: Record<string, string | number | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return `#/${path.map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`;
}

export function navigate(path: string[], query: Record<string, string | number | undefined> = {}): void {
  window.location.hash = href(path, query);
}
