"use client";

import { useEffect } from "react";
import { progress } from "@/lib/progress";

/** Records the page as the "continue where you left off" target. */
export function TrackVisit({ href, title }: { href: string; title: string }) {
  useEffect(() => {
    progress.visit(href, title);
  }, [href, title]);
  return null;
}
