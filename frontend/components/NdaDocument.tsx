import type { ReactNode } from "react";
import {
  fillStandardTerms,
  formatDate,
  formatYears,
  type NdaFormData,
} from "@/lib/nda";
import type { MutualNdaTemplates } from "@/lib/templates";
import { Markdown } from "./Markdown";

function Placeholder({ children }: { children: string }) {
  return <span className="italic text-gray-400">[{children}]</span>;
}

function Section({
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

function Choice({ checked, children }: { checked: boolean; children: ReactNode }) {
  return (
    <p className="flex gap-2">
      <span aria-label={checked ? "Selected" : "Not selected"}>
        {checked ? "☒" : "☐"}
      </span>
      <span>{children}</span>
    </p>
  );
}

const SIGNATURE_ROWS: {
  label: string;
  hint?: string;
  value?: (party: NdaFormData["party1"]) => string;
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

export function NdaDocument({
  data,
  templates,
}: {
  data: NdaFormData;
  templates: MutualNdaTemplates;
}) {
  const purpose = data.purpose.trim();
  const effectiveDate = formatDate(data.effectiveDate);
  const governingLaw = data.governingLaw.trim();
  const jurisdiction = data.jurisdiction.trim();
  const modifications = data.modifications.trim();

  return (
    <article
      id="nda-document"
      className="bg-white p-8 font-serif text-[15px] leading-relaxed text-black shadow-sm ring-1 ring-gray-200 sm:p-12 print:p-0 print:shadow-none print:ring-0"
    >
      <Markdown>{templates.coverIntro}</Markdown>

      <Section title="Purpose" hint="How Confidential Information may be used">
        <p>{purpose || <Placeholder>Purpose</Placeholder>}</p>
      </Section>

      <Section title="Effective Date">
        <p>{effectiveDate || <Placeholder>Effective Date</Placeholder>}</p>
      </Section>

      <Section title="MNDA Term" hint="The length of this MNDA">
        <Choice checked={data.termType === "expires"}>
          Expires {formatYears(data.termYears)} from Effective Date.
        </Choice>
        <Choice checked={data.termType === "continues"}>
          Continues until terminated in accordance with the terms of the MNDA.
        </Choice>
      </Section>

      <Section
        title="Term of Confidentiality"
        hint="How long Confidential Information is protected"
      >
        <Choice checked={data.confidentialityType === "years"}>
          {formatYears(data.confidentialityYears)} from Effective Date, but in
          the case of trade secrets until Confidential Information is no longer
          considered a trade secret under applicable laws.
        </Choice>
        <Choice checked={data.confidentialityType === "perpetuity"}>
          In perpetuity.
        </Choice>
      </Section>

      <Section title="Governing Law & Jurisdiction">
        <p>
          Governing Law:{" "}
          {governingLaw || <Placeholder>Fill in state</Placeholder>}
        </p>
        <p>
          Jurisdiction:{" "}
          {jurisdiction ? (
            `courts located in ${jurisdiction}`
          ) : (
            <Placeholder>Fill in city or county and state</Placeholder>
          )}
        </p>
      </Section>

      <Section title="MNDA Modifications">
        <p className="whitespace-pre-wrap">{modifications || "None."}</p>
      </Section>

      <p className="mb-3 mt-6 break-after-avoid">{templates.signingStatement}</p>

      <table className="mb-6 w-full break-inside-avoid border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-1/4 border border-gray-400 p-2" />
            <th className="border border-gray-400 p-2">PARTY 1</th>
            <th className="border border-gray-400 p-2">PARTY 2</th>
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
                  <span className="block text-xs font-normal italic text-gray-500">
                    {hint}
                  </span>
                )}
              </th>
              {[data.party1, data.party2].map((party, i) => (
                <td
                  key={i}
                  className={`whitespace-pre-wrap border border-gray-400 p-2 align-top ${tall ? "h-16" : ""}`}
                >
                  {value?.(party)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="text-xs text-gray-600">
        <Markdown>{templates.coverAttribution}</Markdown>
      </div>

      <section className="break-before-page pt-8 print:pt-0">
        <Markdown>{fillStandardTerms(templates.standardTerms, data)}</Markdown>
      </section>
    </article>
  );
}
