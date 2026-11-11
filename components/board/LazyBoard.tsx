"use client";

import dynamic from "next/dynamic";

// The whole board (including its localStorage read) runs client-side only.
export const LazyBoard = dynamic(async () => (await import("./Board")).Board, {
  ssr: false,
  loading: () => (
    <div className="grid h-[70vh] place-items-center rounded-2xl border border-border bg-surface text-sm text-muted">
      Loading whiteboard…
    </div>
  ),
});

export const LazyWhiteboardHub = dynamic(async () => (await import("../WhiteboardHub")).WhiteboardHub, {
  ssr: false,
  loading: () => (
    <div className="grid h-[78vh] place-items-center rounded-2xl border border-border bg-surface text-sm text-muted">
      Loading boards…
    </div>
  ),
});
