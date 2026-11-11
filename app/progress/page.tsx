import type { Metadata } from "next";
import { getCatalog } from "@/lib/content";
import { ProgressView } from "@/components/ProgressView";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Progress</h1>
      <p className="mt-2 text-muted">
        Everything is stored locally in this browser. Download a backup now and then, and restore it on another machine.
      </p>
      <ProgressView catalog={getCatalog()} />
    </div>
  );
}
