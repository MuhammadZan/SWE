import { Dashboard } from "@/components/Dashboard";
import { getCatalog, phases } from "@/lib/content";

export default function Home() {
  const catalog = getCatalog();
  const blurbs = Object.fromEntries(phases.map((p) => [p.id, { tagline: p.tagline, objective: p.objective }]));
  return <Dashboard catalog={catalog} blurbs={blurbs} />;
}
