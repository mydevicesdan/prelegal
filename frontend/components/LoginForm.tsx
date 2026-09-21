"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { startSession } from "@/lib/session";

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40";

/** Fake login: any input is accepted. Real authentication comes in a later ticket. */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startSession(email.trim());
    router.push("/nda/");
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <h1 className="text-3xl font-bold text-brand-navy">Prelegal</h1>
      <p className="mt-1 text-sm text-gray-600">Sign in to draft your legal agreements.</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-brand-navy">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-brand-navy">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-brand-purple px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-purple/90 focus:outline-none focus:ring-2 focus:ring-brand-blue"
        >
          Sign in
        </button>
      </form>

      <p className="mt-6 text-xs text-gray-600">
        This is a preview: authentication is not enabled yet, so any details will do.
      </p>
    </div>
  );
}
