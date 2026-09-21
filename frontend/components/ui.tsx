"use client";

import Link from "next/link";
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

/** The Prelegal mark: a sheet of paper with a folded corner and a ruled line. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-brand-purple" />
      <path d="M10 7h8l5 5v13a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" fill="#fff" />
      <path d="M18 7l5 5h-4a1 1 0 0 1-1-1V7Z" fill="#d9c5e2" />
      <path d="M12 16h8M12 19.5h8M12 23h5" stroke="#753991" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ inverted = false, markOnly = false }: { inverted?: boolean; markOnly?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span
        className={`font-display text-2xl font-semibold tracking-tight ${inverted ? "text-white" : "text-brand-navy"} ${
          markOnly ? "sr-only sm:not-sr-only" : ""
        }`}
      >
        Prelegal
      </span>
    </span>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin motion-reduce:animate-none`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-purple text-white hover:bg-brand-purple-dark disabled:hover:bg-brand-purple",
  secondary: "border border-gray-300 bg-white text-brand-navy hover:bg-gray-50 disabled:hover:bg-white",
  ghost: "text-brand-navy hover:bg-gray-100 disabled:hover:bg-transparent",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:hover:bg-red-700",
};
const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-base",
};

function buttonClass(variant: Variant, size: Size, extra = ""): string {
  return `inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks clicks while something is happening. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "primary", size = "md", loading = false, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** A link that looks like a button. */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
  /** Something small on the right of the input, such as a show/hide button. */
  trailing?: ReactNode;
}

export function TextField({ label, error, hint, trailing, className = "", ...input }: TextFieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-800">
        {label}
      </label>
      <div className="relative">
        <input
          {...input}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`h-11 w-full rounded-md border bg-white px-3 text-[15px] text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 ${
            error
              ? "border-red-600 focus:border-red-600 focus:ring-red-600/25"
              : "border-gray-300 focus:border-brand-blue focus:ring-brand-blue/30"
          } ${trailing ? "pr-16" : ""} ${className}`}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-gray-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** A message the user needs to see: something failed, and how to carry on. */
export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  const styles =
    tone === "error"
      ? "border-red-600 bg-red-50 text-red-900"
      : "border-brand-blue bg-sky-50 text-brand-navy";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border-l-4 px-3.5 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

/** A sheet of paper with a folded corner, for empty states. */
export function BlankSheet({ className = "h-28 w-24" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 112" className={className} aria-hidden="true">
      <path
        d="M10 6h50l26 26v70a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z"
        className="fill-white stroke-gray-300"
        strokeWidth="2"
      />
      <path d="M60 6l26 26H64a4 4 0 0 1-4-4V6Z" className="fill-gray-100 stroke-gray-300" strokeWidth="2" strokeLinejoin="round" />
      <path d="M20 52h56M20 66h56M20 80h34" className="stroke-gray-300" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 40h22" className="stroke-brand-yellow" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
