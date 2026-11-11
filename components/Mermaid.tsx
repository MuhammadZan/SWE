"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "./ThemeToggle";

type MermaidApi = typeof import("mermaid").default;
let mermaidPromise: Promise<MermaidApi> | null = null;
const loadMermaid = () => (mermaidPromise ??= import("mermaid").then((m) => m.default));

// Serialize renders: mermaid.initialize is global, so concurrent renders with
// different themes would interfere with each other.
let queue: Promise<unknown> = Promise.resolve();

function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function themeVariables() {
  return {
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
    fontSize: "14px",
    background: token("--surface"),
    primaryColor: token("--surface-2"),
    primaryTextColor: token("--fg"),
    primaryBorderColor: token("--border-strong"),
    secondaryColor: token("--accent-soft"),
    secondaryTextColor: token("--fg"),
    secondaryBorderColor: token("--accent"),
    tertiaryColor: token("--surface"),
    tertiaryTextColor: token("--fg"),
    tertiaryBorderColor: token("--border"),
    lineColor: token("--muted"),
    textColor: token("--fg"),
    mainBkg: token("--surface-2"),
    nodeBorder: token("--border-strong"),
    clusterBkg: token("--surface"),
    clusterBorder: token("--border-strong"),
    titleColor: token("--fg"),
    edgeLabelBackground: token("--surface"),
    noteBkgColor: token("--warn-soft"),
    noteTextColor: token("--fg"),
    noteBorderColor: token("--border-strong"),
    actorBkg: token("--surface-2"),
    actorBorder: token("--border-strong"),
    actorTextColor: token("--fg"),
    actorLineColor: token("--border-strong"),
    signalColor: token("--fg"),
    signalTextColor: token("--fg"),
    labelBoxBkgColor: token("--surface-2"),
    labelBoxBorderColor: token("--border-strong"),
    labelTextColor: token("--fg"),
    loopTextColor: token("--muted"),
    activationBkgColor: token("--accent-soft"),
    activationBorderColor: token("--accent"),
    sequenceNumberColor: token("--accent-fg"),
  };
}

export function Mermaid({ chart }: { chart: string }) {
  const theme = useTheme();
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const job = queue.then(async () => {
      const mermaid = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: themeVariables(),
        flowchart: { curve: "basis", padding: 12 },
        sequence: { mirrorActors: false },
      });
      try {
        const { svg } = await mermaid.render(`${id}-${theme}`, chart);
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? String(e));
        document.getElementById(`d${id}-${theme}`)?.remove(); // mermaid leaves an error node behind
      }
    });
    queue = job.catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chart, theme, id]);

  if (error) {
    return (
      <div className="not-prose">
        <pre className="overflow-x-auto rounded-[10px] border border-border bg-code p-4 font-mono text-[0.84rem]">{chart}</pre>
        <p className="mt-1 text-xs text-danger">Diagram failed to render: {error.split("\n")[0]}</p>
      </div>
    );
  }

  return (
    <figure
      ref={ref}
      className="mermaid-figure overflow-x-auto rounded-xl border border-border bg-surface px-4 py-5"
      aria-label="Diagram"
    >
      {svg ? (
        <div className="flex justify-center [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
      )}
    </figure>
  );
}
