import type { Metadata } from "next";
import { getCatalog } from "@/lib/content";
import { ProgressView } from "@/components/ProgressView";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Progress</h1>
      <p className="mt-2 text-muted">
        Saved to disk in this project&apos;s <code className="font-mono text-sm">data/</code> folder, so clearing the browser
        won&apos;t lose it.
      </p>
      <ProgressView catalog={getCatalog()} />
    </div>
  );
}
