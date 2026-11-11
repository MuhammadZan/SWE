import type { Metadata } from "next";
import { LazyWhiteboardHub } from "@/components/board/LazyBoard";

export const metadata: Metadata = { title: "Whiteboard" };

export default function WhiteboardPage() {
  return (
    <div className="mx-auto max-w-[110rem] px-4 py-8 sm:px-8 lg:py-10">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">Whiteboard</h1>
        <p className="mt-2 text-muted">
          Scratch space for designs. Use <span className="text-fg">Components</span> to drop in load balancers,
          caches, queues and databases, then connect them with the arrow tool (A). Boards save in this browser; export
          PNG or .excalidraw to keep them in a repo.
        </p>
      </header>
      <LazyWhiteboardHub />
    </div>
  );
}
