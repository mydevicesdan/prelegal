"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { Alert, Button, TextField } from "./ui";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 8;
// Keep in step with the backend limits (backend/app/auth_api.py).
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 128;

function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={label}
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      maxLength={MAX_PASSWORD}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      hint={hint}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="rounded px-2 py-1 text-sm font-semibold text-brand-navy hover:bg-gray-100"
        >
          {visible ? "Hide" : "Show"}
        </button>
      }
    />
  );
}

/**
 * Once someone is signed in, the sign in and sign up pages have nothing for them: go to their documents. This is
 * also how a successful sign in or sign up moves on, so there is exactly one navigation.
 */
function useRedirectWhenSignedIn() {
  const router = useRouter();
  const { state } = useAuth();
  useEffect(() => {
    if (state.status === "signedIn") router.replace("/documents/");
  }, [state.status, router]);
}

export function SignInForm() {
  const { signIn } = useAuth();
  useRedirectWhenSignedIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const errors = {
    email: !EMAIL.test(email.trim()) ? "Enter your email address." : undefined,
    password: !password ? "Enter your password." : undefined,
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setFailure(null);
    if (errors.email || errors.password) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password); // the redirect takes it from here
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="mb-1.5 font-display text-3xl font-semibold tracking-tight text-brand-navy">Sign in</h1>
      <p className="mb-8 text-gray-600">Pick up your drafts where you left them.</p>
      <form onSubmit={submit} noValidate className="space-y-5">
        {failure && <Alert>{failure}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          maxLength={MAX_EMAIL}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={submitted ? errors.email : undefined}
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={submitted ? errors.password : undefined}
        />
        <Button type="submit" size="lg" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-gray-700">
        New to Prelegal?{" "}
        <Link href="/signup/" className="font-semibold text-brand-navy underline underline-offset-2 hover:text-brand-purple">
          Create an account
        </Link>
      </p>
    </>
  );
}

export function SignUpForm() {
  const { signUp } = useAuth();
  useRedirectWhenSignedIn();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const errors = {
    name: !name.trim() ? "Enter your name." : undefined,
    email: !EMAIL.test(email.trim()) ? "Enter a valid email address, like name@company.com." : undefined,
    password: password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : undefined,
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setFailure(null);
    if (errors.name || errors.email || errors.password) return;
    setBusy(true);
    try {
      await signUp(name.trim(), email.trim(), password); // the redirect takes it from here
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="mb-1.5 font-display text-3xl font-semibold tracking-tight text-brand-navy">Create your account</h1>
      <p className="mb-8 text-gray-600">Free to start. Your drafts are saved as you work.</p>
      <form onSubmit={submit} noValidate className="space-y-5">
        {failure && <Alert>{failure}</Alert>}
        <TextField
          label="Full name"
          autoComplete="name"
          maxLength={MAX_NAME}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={submitted ? errors.name : undefined}
        />
        <TextField
          label="Work email"
          type="email"
          autoComplete="email"
          maxLength={MAX_EMAIL}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={submitted ? errors.email : undefined}
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={submitted ? errors.password : undefined}
        />
        <Button type="submit" size="lg" loading={busy} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-gray-700">
        Already have an account?{" "}
        <Link href="/" className="font-semibold text-brand-navy underline underline-offset-2 hover:text-brand-purple">
          Sign in
        </Link>
      </p>
    </>
  );
}
