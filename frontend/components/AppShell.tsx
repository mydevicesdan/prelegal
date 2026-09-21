"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { initials, useAuth } from "@/lib/auth";
import { Alert, Button, Logo, Spinner } from "./ui";

/** Everything a signed-in person sees around a page: the header with navigation, and the footer. */
export function AppShell({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "signedOut") router.replace("/");
  }, [state.status, router]);

  if (state.status !== "signedIn") {
    return (
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 text-gray-600">
        <Logo />
        <Spinner className="h-5 w-5" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  const { user } = state;
  const inDocuments = pathname.startsWith("/documents");
  // The editor carries its own draft notice above the agreement, so the footer does not repeat it there.
  const inEditor = pathname.startsWith("/create");

  // "New document" from inside the editor must start a fresh one, even though the address is the same page.
  const newDocument = (event: React.MouseEvent) => {
    if (pathname.startsWith("/create")) {
      event.preventDefault();
      router.push(`/create/?new=${Date.now()}`);
    }
  };

  // The state change in signOut sends the person back to sign in (see the effect above).
  const logOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : "Could not sign you out. Please try again.");
      setSigningOut(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:text-brand-navy focus:shadow-lg print:hidden"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white print:hidden">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-8">
            <Link href="/documents/" aria-label="Prelegal, my documents">
              <Logo markOnly />
            </Link>
            <nav aria-label="Main">
              <Link
                href="/documents/"
                aria-current={inDocuments ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-2 py-2 text-sm font-medium sm:px-3 ${
                  inDocuments ? "bg-gray-100 text-brand-navy" : "text-gray-700 hover:bg-gray-50 hover:text-brand-navy"
                }`}
              >
                My documents
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/create/"
              onClick={newDocument}
              aria-label="New document"
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-brand-purple px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-purple-dark sm:px-4"
            >
              New<span className="hidden sm:inline">&nbsp;document</span>
            </Link>
            <div className="flex items-center gap-1 border-l border-gray-200 pl-2 sm:gap-2 sm:pl-3">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-navy text-xs font-bold text-white"
              >
                {initials(user.name)}
              </span>
              <span className="hidden max-w-40 truncate text-sm font-medium text-gray-800 md:block" title={user.email}>
                {user.name}
              </span>
              <Button variant="ghost" size="sm" onClick={logOut} loading={signingOut} className="whitespace-nowrap px-2 sm:px-3">
                Log out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {signOutError && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 print:hidden">
          <Alert>{`You are still signed in. ${signOutError}`}</Alert>
        </div>
      )}

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-gray-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-5 text-sm text-gray-600 sm:px-6 md:flex-row md:justify-between">
          {!inEditor && (
            <p>
              Documents made with Prelegal are drafts and are subject to legal review. Prelegal does not give legal
              advice.
            </p>
          )}
          <p>Agreements based on Common Paper, CC BY 4.0.</p>
        </div>
      </footer>
    </div>
  );
}
