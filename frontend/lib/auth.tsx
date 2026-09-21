"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { UNAUTHORIZED_EVENT, api } from "@/lib/api";

export interface User {
  id: number;
  name: string;
  email: string;
}

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: User };

interface Auth {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/** Who is signed in, according to the server (the session lives in an HttpOnly cookie the page cannot read). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api<{ user: User | null }>("/api/auth/session").then(
      ({ user }) => !cancelled && setState(user ? { status: "signedIn", user } : { status: "signedOut" }),
      () => !cancelled && setState({ status: "signedOut" }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const signedOut = () => setState({ status: "signedOut" });
    window.addEventListener(UNAUTHORIZED_EVENT, signedOut);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signedOut);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const user = await api<User>("/api/auth/login", { method: "POST", body: { email, password } });
    setState({ status: "signedIn", user });
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const user = await api<User>("/api/auth/signup", { method: "POST", body: { name, email, password } });
    setState({ status: "signedIn", user });
  }, []);

  /** Throws if the server could not end the session: the person is then still signed in, and is told so. */
  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setState({ status: "signedOut" });
  }, []);

  const value = useMemo(() => ({ state, signIn, signUp, signOut }), [state, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside <AuthProvider>");
  return auth;
}

/** "Ada Lovelace" -> "AL" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1);
  return letters.map((part) => part[0]!.toUpperCase()).join("");
}
