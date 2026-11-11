"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteBoard, listBoards, newBoardId, upsertBoardMeta, type BoardMeta } from "@/lib/boards";
import { LazyBoard } from "./board/LazyBoard";
import { Icon } from "./Icon";

export function WhiteboardHub() {
  // Rendered client-only (see LazyWhiteboardHub), so localStorage is available here.
  const [boards, setBoards] = useState<BoardMeta[]>(() => {
    if (!listBoards().some((b) => !b.problemSlug)) upsertBoardMeta({ id: "scratch", title: "Scratchpad" });
    return listBoards();
  });
  const [active, setActive] = useState<BoardMeta | null>(() => boards.find((b) => !b.problemSlug) ?? boards[0] ?? null);

  function refresh() {
    setBoards(listBoards());
  }

  function create() {
    const title = prompt("Board name", "Untitled design")?.trim();
    if (!title) return;
    const meta = { id: newBoardId(), title };
    upsertBoardMeta(meta);
    refresh();
    setActive({ ...meta, updatedAt: new Date().toISOString() });
  }

  function remove(b: BoardMeta) {
    if (!confirm(`Delete "${b.title}"? This cannot be undone.`)) return;
    deleteBoard(b.id);
    const list = listBoards();
    setBoards(list);
    if (active?.id === b.id) setActive(list.find((x) => !x.problemSlug) ?? list[0] ?? null);
  }

  const free = boards.filter((b) => !b.problemSlug);
  const linked = boards.filter((b) => b.problemSlug);

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="space-y-5">
        <button
          onClick={create}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-fg px-3 py-2 text-sm font-medium text-bg hover:opacity-90"
        >
          <Icon name="plus" className="size-4" /> New board
        </button>
        <BoardList title="Your boards" boards={free} active={active} onPick={setActive} onDelete={remove} />
        {linked.length > 0 && (
          <BoardList title="Problem boards" boards={linked} active={active} onPick={setActive} onDelete={remove} linked />
        )}
      </aside>
      <div className="min-w-0">
        {active ? (
          <LazyBoard key={active.id} boardId={active.id} title={active.title} problemSlug={active.problemSlug} className="h-[78vh]" />
        ) : (
          <div className="grid h-[78vh] place-items-center rounded-2xl border border-border bg-surface text-sm text-muted">
            Loading…
          </div>
        )}
        {active?.problemSlug && (
          <p className="mt-2 text-xs text-muted">
            This board belongs to{" "}
            <Link href={`/problems/${active.problemSlug}#whiteboard`} className="text-accent hover:underline">
              its problem page
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}

function BoardList({
  title,
  boards,
  active,
  onPick,
  onDelete,
  linked,
}: {
  title: string;
  boards: BoardMeta[];
  active: BoardMeta | null;
  onPick: (b: BoardMeta) => void;
  onDelete: (b: BoardMeta) => void;
  linked?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 px-1 text-[0.7rem] font-medium tracking-wider text-subtle uppercase">{title}</div>
      <ul className="space-y-0.5">
        {boards.map((b) => (
          <li key={b.id} className="group flex items-center">
            <button
              onClick={() => onPick(b)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                active?.id === b.id ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              <Icon name={linked ? "code" : "pen"} className="size-3.5 shrink-0" />
              <span className="truncate">{b.title}</span>
            </button>
            <button
              onClick={() => onDelete(b)}
              className="rounded p-1 text-subtle opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
              aria-label={`Delete ${b.title}`}
            >
              <Icon name="trash" className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
