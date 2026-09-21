"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { endSession, readSession } from "@/lib/session";

const subscribeNever = () => () => {};

/** undefined while prerendering/hydrating, then the session email or null. */
function useSessionEmail(): string | null | undefined {
  return useSyncExternalStore(subscribeNever, readSession, () => undefined);
}

/** Shows its children only to a signed-in user; everyone else is sent to the login screen. */
export function RequireLogin({ children }: { children: ReactNode }) {
  const router = useRouter();
  const email = useSessionEmail();

  useEffect(() => {
    if (email === null) router.replace("/");
  }, [email, router]);

  // The fake login accepts an empty email, so "" is still a valid session.
  if (email == null) return null;

  const logOut = () => {
    endSession();
    router.replace("/");
  };

  return (
    <>
      <nav className="flex items-center justify-end gap-3 bg-brand-navy px-4 py-2 text-sm text-white print:hidden">
        {email && <span>{email}</span>}
        <button
          type="button"
          onClick={logOut}
          className="rounded px-2 py-1 font-semibold underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-blue"
        >
          Log out
        </button>
      </nav>
      {children}
    </>
  );
}
