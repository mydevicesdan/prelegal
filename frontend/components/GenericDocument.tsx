import {
  emptyParty,
  groupFields,
  type DocumentSpec,
  type FieldValues,
  type PartiesByRole,
} from "@/lib/documents";
import { Placeholder, Section, SignatureTable } from "./documentParts";
import { Markdown } from "./Markdown";

const ATTRIBUTION =
  "Based on the Common Paper {name} standard terms, free to use under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).";

/**
 * Any document other than the Mutual NDA. The templates hold only the standard terms, so the front page
 * (the parties and the details the terms refer to) is generated from what the user has told the assistant.
 */
export function GenericDocument({
  spec,
  values,
  parties,
}: {
  spec: DocumentSpec;
  values: FieldValues;
  parties: PartiesByRole;
}) {
  const party = (role: string) => parties[role] ?? emptyParty;

  return (
    <article
      id="document"
      aria-label={spec.name}
      className="bg-white p-8 font-serif text-[15px] leading-relaxed text-black shadow-sm ring-1 ring-gray-200 sm:p-12 print:p-0 print:shadow-none print:ring-0"
    >
      <h1 className="mb-4 text-center text-2xl font-bold">{spec.name}</h1>

      <Section title="Parties" hint="The parties to this agreement">
        {spec.parties.map((role) => (
          <p key={role}>
            {role}: {party(role).company.trim() || <Placeholder>{`${role} company`}</Placeholder>}
          </p>
        ))}
      </Section>

      {groupFields(spec).map(({ title, fields }) => (
        <Section key={title} title={title}>
          {fields.map((field) => {
            const value = (values[field.key] ?? "").trim();
            return (
              <p key={field.key} className="whitespace-pre-wrap">
                <span className="font-semibold">{field.label}:</span>{" "}
                {value || <Placeholder>{field.label}</Placeholder>}
              </p>
            );
          })}
        </Section>
      ))}

      <p className="mb-3 mt-6 break-after-avoid">
        By signing, each party agrees to be bound by the details above and the Standard Terms below.
      </p>

      <SignatureTable
        parties={spec.parties.map((role) => ({ heading: role.toUpperCase(), party: party(role) }))}
      />

      <div className="text-xs text-gray-600">
        <Markdown>{ATTRIBUTION.replace("{name}", spec.name)}</Markdown>
      </div>

      <section className="break-before-page pt-8 print:pt-0">
        <h2 className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide">Standard Terms</h2>
        <div className="legal-numbering">
          <Markdown>{spec.terms}</Markdown>
        </div>
      </section>
    </article>
  );
}
