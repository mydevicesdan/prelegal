import type { ReactNode } from "react";
import { Logo } from "./ui";

/** A clause from the Cloud Service Agreement, with one field just filled in: what the product does, at a glance. */
function AgreementExcerpt() {
  return (
    <figure
      aria-label="Example of a draft agreement being filled in"
      className="relative max-w-md rounded-sm bg-white p-7 font-serif text-[15px] leading-relaxed text-gray-900 shadow-lg"
    >
      <span className="absolute -top-3 right-5 rounded-sm bg-brand-yellow px-2.5 py-0.5 font-sans text-xs font-bold text-brand-navy">
        Draft
      </span>
      <p className="mb-3 text-lg font-semibold text-brand-navy">Cloud Service Agreement</p>
      <p>
        <span className="font-semibold">Provider:</span> Acme Inc
      </p>
      <p>
        <span className="font-semibold">Customer:</span> Globex LLC
      </p>
      <p className="mb-4">
        <span className="font-semibold">Governing Law:</span>{" "}
        <span className="highlight-sweep px-1">Delaware</span>
      </p>
      <p>
        <span className="font-semibold">12.3. Governing Law and Chosen Courts.</span> The{" "}
        <span className="font-semibold">Governing Law</span> will govern all interpretations and disputes about this
        Agreement, without regard to its conflict of laws provisions.
      </p>
    </figure>
  );
}

/** The frame around sign in and sign up: a brand panel with the product in one picture, and the form. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[5fr_6fr]">
      <aside className="hidden flex-col justify-between bg-brand-navy px-14 py-12 text-white lg:flex">
        <Logo inverted />
        <div>
          <p className="mb-4 max-w-md font-display text-[2.75rem] font-medium leading-[1.08] tracking-tight">
            Draft the agreement. Then send it to your lawyer.
          </p>
          <p className="mb-10 max-w-md text-base leading-relaxed text-sky-100">
            Tell the assistant what you need. Prelegal fills in a Common Paper agreement as you talk, and keeps every
            draft in your account.
          </p>
          <AgreementExcerpt />
        </div>
        <p className="text-sm text-sky-200">Built on Common Paper standard agreements, shared under CC BY 4.0.</p>
      </aside>

      <main className="flex flex-col justify-center bg-white px-6 py-10 sm:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          {children}
          <p className="mt-10 border-t border-gray-200 pt-5 text-sm text-gray-600">
            Documents made with Prelegal are drafts, not legal advice, and are subject to legal review.
          </p>
        </div>
      </main>
    </div>
  );
}
