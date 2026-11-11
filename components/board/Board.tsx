"use client";

import "@excalidraw/excalidraw/index.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { loadScene, saveScene, upsertBoardMeta, type StoredScene } from "@/lib/boards";
import { useTheme } from "../ThemeToggle";
import { Icon } from "../Icon";
import { STENCILS, starterTemplate, stencilSkeleton } from "./stencils";

const Excalidraw = dynamic(async () => (await import("@excalidraw/excalidraw")).Excalidraw, {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Loading whiteboard…</div>,
});

type Props = {
  boardId: string;
  title: string;
  problemSlug?: string;
  className?: string;
};

export function Board({ boardId, title, problemSlug, className = "h-[70vh]" }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [full, setFull] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const [initial] = useState<StoredScene | null>(() => (typeof window === "undefined" ? null : loadScene(boardId)));
  const theme = useTheme();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVersion = useRef<number>(-1);
  const insertCount = useRef(0);

  const initialData = useMemo(
    () =>
      initial
        ? { elements: initial.elements, appState: initial.appState, files: initial.files, scrollToContent: true }
        : { appState: { viewBackgroundColor: "#ffffff" } },
    [initial],
  );

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const onChange = useCallback(
    (elements: readonly { version: number; isDeleted: boolean }[], appState: { viewBackgroundColor: string; gridModeEnabled?: boolean }, files: Record<string, unknown>) => {
      const version = elements.reduce((a, e) => a + e.version, 0);
      if (version === lastVersion.current) return; // pointer moves, scrolls etc.
      lastVersion.current = version;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const ok = saveScene(boardId, {
          elements: elements.filter((e) => !e.isDeleted) as unknown[],
          appState: { viewBackgroundColor: appState.viewBackgroundColor, gridModeEnabled: appState.gridModeEnabled },
          files,
        });
        upsertBoardMeta({ id: boardId, title, problemSlug });
        setSaveState(ok ? "saved" : "failed");
      }, 600);
    },
    [boardId, title, problemSlug],
  );

  function viewportCenter() {
    if (!api) return { x: 0, y: 0 };
    const s = api.getAppState();
    const zoom = s.zoom.value;
    return { x: -s.scrollX + s.width / 2 / zoom, y: -s.scrollY + s.height / 2 / zoom };
  }

  async function insert(skeletons: unknown[]) {
    if (!api) return;
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const created = convertToExcalidrawElements(skeletons as Parameters<typeof convertToExcalidrawElements>[0]);
    api.updateScene({ elements: [...api.getSceneElements(), ...created] });
    // Select the new shapes so they can be dragged into place immediately.
    api.updateScene({
      appState: { selectedElementIds: Object.fromEntries(created.map((e) => [e.id, true])) } as never,
    });
  }

  function addStencil(key: string) {
    const s = STENCILS.find((x) => x.key === key)!;
    const c = viewportCenter();
    const n = insertCount.current++ % 6;
    void insert([stencilSkeleton(s, c.x + n * 24, c.y + n * 24)]);
  }

  function addTemplate() {
    const c = viewportCenter();
    void insert(starterTemplate(c.x, c.y)).then(() => api?.scrollToContent(undefined, { fitToContent: true }));
  }

  async function exportPng() {
    if (!api) return;
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
      files: api.getFiles(),
      mimeType: "image/png",
      exportPadding: 24,
      getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
    });
    download(blob, `${fileBase(title)}.png`);
  }

  async function exportScene() {
    if (!api) return;
    const { serializeAsJSON } = await import("@excalidraw/excalidraw");
    const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
    download(new Blob([json], { type: "application/json" }), `${fileBase(title)}.excalidraw`);
  }

  function clearBoard() {
    if (!api || !confirm("Clear everything on this board?")) return;
    api.resetScene();
    lastVersion.current = -1;
    saveScene(boardId, { elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
  }

  return (
    <div
      className={
        full
          ? "fixed inset-0 z-50 flex flex-col bg-bg"
          : `flex flex-col overflow-hidden rounded-2xl border border-border bg-surface ${className}`
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-2.5 py-2">
        <details className="group relative">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2">
            <Icon name="layers" className="size-3.5" /> Components
          </summary>
          <div className="absolute top-full left-0 z-20 mt-1.5 grid w-72 grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-2 shadow-lg">
            {STENCILS.map((s) => (
              <button
                key={s.key}
                onClick={(e) => {
                  addStencil(s.key);
                  (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2"
              >
                <span
                  className={`size-3 shrink-0 border border-black/40 ${
                    s.shape === "ellipse" ? "rounded-full" : s.shape === "diamond" ? "rotate-45" : "rounded-[3px]"
                  } ${s.dashed ? "border-dashed" : ""}`}
                  style={{ background: s.bg }}
                />
                {s.label}
              </button>
            ))}
            <button
              onClick={(e) => {
                addTemplate();
                (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
              }}
              className="col-span-2 mt-1 rounded-md border border-dashed border-border-strong px-2 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-fg"
            >
              Insert starter architecture
            </button>
          </div>
        </details>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolButton onClick={exportPng} icon="download" label="PNG" title="Export as PNG (commit this to your repo)" />
        <ToolButton onClick={exportScene} icon="download" label=".excalidraw" title="Export the editable scene file" />
        <ToolButton onClick={clearBoard} icon="trash" label="Clear" title="Clear the board" />
        <span className="ml-auto pr-1 text-[0.7rem] text-subtle">
          {saveState === "saved" && "Saved locally"}
          {saveState === "failed" && <span className="text-danger">Not saved: storage full (remove large images)</span>}
        </span>
        <ToolButton
          onClick={() => setFull((f) => !f)}
          icon={full ? "minimize" : "maximize"}
          label={full ? "Exit" : "Focus"}
          title={full ? "Exit focus mode (Esc)" : "Expand to full screen"}
        />
      </div>
      <div className="board-host relative min-h-0 flex-1">
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={initialData as never}
          onChange={onChange as never}
          theme={theme}
          name={title}
          UIOptions={{ canvasActions: { loadScene: true, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
        />
      </div>
    </div>
  );
}

function ToolButton({
  onClick,
  icon,
  label,
  title,
}: {
  onClick: () => void;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-fg"
    >
      <Icon name={icon} className="size-3.5" />
      {label}
    </button>
  );
}

function fileBase(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "diagram";
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
