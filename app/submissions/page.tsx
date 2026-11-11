import type { Metadata } from "next";
import { getCatalog } from "@/lib/content";
import { SubmissionsTable } from "@/components/SubmissionsTable";

export const metadata: Metadata = { title: "Submissions" };

export default function SubmissionsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Submissions</h1>
      <p className="mt-2 text-muted">Every problem, its status, and the repo you shipped. Your portfolio, in one list.</p>
      <SubmissionsTable catalog={getCatalog()} />
    </div>
  );
}
