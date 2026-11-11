"use client";

import dynamic from "next/dynamic";
import { initStore } from "@/lib/store";

// Boards run client-side only, and only after the on-disk store has been loaded,
// so they never start from a stale or empty cache.
export const LazyBoard = dynamic(async () => (await Promise.all([import("./Board"), initStore()]))[0].Board, {
  ssr: false,
  loading: () => (
    <div className="grid h-[70vh] place-items-center rounded-2xl border border-border bg-surface text-sm text-muted">
      Loading whiteboard…
    </div>
  ),
});

export const LazyWhiteboardHub = dynamic(
  async () => (await Promise.all([import("../WhiteboardHub"), initStore()]))[0].WhiteboardHub,
  {
  ssr: false,
  loading: () => (
    <div className="grid h-[78vh] place-items-center rounded-2xl border border-border bg-surface text-sm text-muted">
      Loading boards…
    </div>
  ),
  },
);
