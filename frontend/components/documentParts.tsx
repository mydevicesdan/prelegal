import type { ReactNode } from "react";
import type { Party } from "@/lib/nda";

export function Placeholder({ children }: { children: string }) {
  return <span className="italic text-gray-500">[{children}]</span>;
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 break-inside-avoid">
      <h3 className="text-base font-bold">{title}</h3>
      {hint && <p className="text-xs italic text-gray-500">{hint}</p>}
      <div className="mt-1 space-y-1">{children}</div>
    </section>
  );
}

const SIGNATURE_ROWS: {
  label: string;
  hint?: string;
  value?: (party: Party) => string;
  tall?: boolean;
}[] = [
  { label: "Signature", tall: true },
  { label: "Print Name", value: (p) => p.name },
  { label: "Title", value: (p) => p.title },
  { label: "Company", value: (p) => p.company },
  {
    label: "Notice Address",
    hint: "Use either email or postal address",
    value: (p) => p.address,
  },
  { label: "Date" },
];

/** The signing table: one column per party; signature and date are left blank to be filled in by hand. */
export function SignatureTable({ parties }: { parties: { heading: string; party: Party }[] }) {
  return (
    <table className="mb-6 w-full break-inside-avoid border-collapse text-sm">
      <thead>
        <tr>
          <th className="w-1/4 border border-gray-400 p-2" />
          {parties.map(({ heading }) => (
            <th key={heading} className="border border-gray-400 p-2">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {SIGNATURE_ROWS.map(({ label, hint, value, tall }) => (
          <tr key={label}>
            <th
              scope="row"
              className="border border-gray-400 p-2 text-left align-top font-semibold"
            >
              {label}
              {hint && (
                <span className="block text-xs font-normal italic text-gray-500">{hint}</span>
              )}
            </th>
            {parties.map(({ heading, party }) => (
              <td
                key={heading}
                className={`whitespace-pre-wrap border border-gray-400 p-2 align-top ${tall ? "h-16" : ""}`}
              >
                {value?.(party)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
