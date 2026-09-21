"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { deleteDraft, listDrafts, type DraftSummary } from "@/lib/drafts";
import { fullDateTime, relativeTime } from "@/lib/format";
import { Alert, BlankSheet, Button, ButtonLink } from "./ui";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; drafts: DraftSummary[] };

function PageHeader({ headingRef }: { headingRef: Ref<HTMLHeadingElement> }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-4xl font-semibold tracking-tight text-brand-navy focus:outline-none"
        >
          My documents
        </h1>
        <p className="mt-1.5 text-gray-600">Drafts are saved automatically as you chat. Open one to keep working on it.</p>
      </div>
      <ButtonLink href="/create/" size="lg">
        New document
      </ButtonLink>
    </div>
  );
}

function LoadingRows() {
  return (
    <div role="status" aria-busy="true" className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
      <span className="sr-only">Loading your documents</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center justify-between gap-6 px-5 py-5" aria-hidden="true">
          <div className="space-y-2.5">
            <div className="h-4 w-56 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
            <div className="h-3.5 w-36 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
          </div>
          <div className="h-8 w-20 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
      <BlankSheet />
      <h2 className="mt-6 font-display text-2xl font-semibold text-brand-navy">No documents yet</h2>
      <p className="mt-2 max-w-sm text-gray-600">
        Tell the assistant what you need, such as an NDA or a cloud service agreement. Your draft is saved here as you
        go.
      </p>
      <ButtonLink href="/create/" size="lg" className="mt-6">
        Start a document
      </ButtonLink>
    </div>
  );
}

function Row({
  draft,
  onDelete,
  deleting,
}: {
  draft: DraftSummary;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const href = `/create/?draft=${draft.id}`;

  // The button that had focus disappears when the row switches between asking and confirming: keep the keyboard
  // user's place by moving focus to the button that took over.
  const deleteButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
    else if (restoreFocus.current) deleteButton.current?.focus();
    restoreFocus.current = false;
  }, [confirming]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0">
        <Link
          href={href}
          className="font-display text-xl font-semibold text-brand-navy underline-offset-2 hover:underline"
        >
          {draft.documentName}
        </Link>
        <p className="mt-0.5 truncate text-gray-700">
          {draft.companies.length > 0 ? draft.companies.join(" and ") : <span className="text-gray-500">No parties named yet</span>}
        </p>
        <p className="mt-1.5 flex items-center gap-4 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-yellow" />
            Draft
          </span>
          <time dateTime={draft.updatedAt} title={fullDateTime(draft.updatedAt)}>
            Updated {relativeTime(draft.updatedAt)}
          </time>
        </p>
      </div>

      <div className="flex items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm font-medium text-gray-800">Delete this document?</span>
            <Button
              key="confirm"
              ref={confirmButton}
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={() => onDelete(draft.id)}
            >
              Delete
            </Button>
            <Button
              key="keep"
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={() => {
                restoreFocus.current = true;
                setConfirming(false);
              }}
            >
              Keep
            </Button>
          </>
        ) : (
          <>
            <ButtonLink key="open" href={href} variant="secondary" size="sm">
              Open{" "}
              <span className="sr-only">{`${draft.documentName}${draft.companies.length ? `, ${draft.companies.join(" and ")}` : ""}`}</span>
            </ButtonLink>
            <Button
              key="delete"
              ref={deleteButton}
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(true)}
              className="text-red-700 hover:bg-red-50"
            >
              Delete{" "}
              <span className="sr-only">{draft.documentName}</span>
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** The signed-in user's saved drafts, newest first. */
export function MyDocuments() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const fetchDrafts = useCallback(() => {
    let cancelled = false;
    listDrafts().then(
      (drafts) => !cancelled && setLoad({ status: "ready", drafts }),
      (error: Error) => !cancelled && setLoad({ status: "error", message: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => fetchDrafts(), [fetchDrafts]);

  const retry = () => {
    setLoad({ status: "loading" });
    fetchDrafts();
  };

  const remove = async (id: number) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteDraft(id);
      heading.current?.focus(); // the row that had focus is about to go
      setLoad((current) =>
        current.status === "ready" ? { status: "ready", drafts: current.drafts.filter((d) => d.id !== id) } : current,
      );
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete the document. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader headingRef={heading} />
      {deleteError && (
        <div className="mb-4">
          <Alert>{deleteError}</Alert>
        </div>
      )}
      {load.status === "loading" && <LoadingRows />}
      {load.status === "error" && (
        <div className="space-y-4">
          <Alert>{load.message}</Alert>
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
      {load.status === "ready" &&
        (load.drafts.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {load.drafts.map((draft) => (
              <Row key={draft.id} draft={draft} onDelete={remove} deleting={deletingId === draft.id} />
            ))}
          </ul>
        ))}
    </div>
  );
}
