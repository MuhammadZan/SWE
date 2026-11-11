// Client-safe course index (no markdown bodies) used for progress math.
import type { ProblemMeta } from "./types";

export type CatalogPhase = {
  id: number;
  slug: string;
  title: string;
  lessons: { slug: string; title: string; minutes: number }[];
  problems: {
    slug: string;
    title: string;
    kind: ProblemMeta["kind"];
    needsDiagram: boolean;
    estimatedHours: number;
  }[];
};

export type Catalog = CatalogPhase[];
