import type { ReactNode } from "react";
import type { NdaFormData, Party } from "@/lib/nda";

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-100 disabled:text-gray-400";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-800">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-gray-900">{legend}</legend>
      {children}
    </fieldset>
  );
}

function RadioOption({
  name,
  checked,
  onSelect,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-800">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="h-4 w-4 accent-indigo-600"
      />
      {children}
    </label>
  );
}

function YearsInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={id}
      type="number"
      min={1}
      step={1}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Number of years"
      className={`${inputClass} !w-20`}
    />
  );
}

function PartyFields({
  prefix,
  legend,
  party,
  onChange,
}: {
  prefix: "party1" | "party2";
  legend: string;
  party: Party;
  onChange: (patch: Partial<Party>) => void;
}) {
  return (
    <Fieldset legend={legend}>
      <Field id={`${prefix}-company`} label="Company">
        <input
          id={`${prefix}-company`}
          className={inputClass}
          value={party.company}
          onChange={(e) => onChange({ company: e.target.value })}
        />
      </Field>
      <Field id={`${prefix}-name`} label="Signatory name">
        <input
          id={`${prefix}-name`}
          className={inputClass}
          value={party.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>
      <Field id={`${prefix}-title`} label="Title">
        <input
          id={`${prefix}-title`}
          className={inputClass}
          value={party.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>
      <Field
        id={`${prefix}-address`}
        label="Notice address"
        hint="Email or postal address for legal notices."
      >
        <textarea
          id={`${prefix}-address`}
          rows={2}
          className={inputClass}
          value={party.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />
      </Field>
    </Fieldset>
  );
}

export function NdaForm({
  data,
  onChange,
  onPartyChange,
}: {
  data: NdaFormData;
  onChange: (patch: Partial<NdaFormData>) => void;
  onPartyChange: (party: "party1" | "party2", patch: Partial<Party>) => void;
}) {
  return (
    <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
      <Fieldset legend="Agreement details">
        <Field
          id="purpose"
          label="Purpose"
          hint="How Confidential Information may be used."
        >
          <textarea
            id="purpose"
            rows={3}
            className={inputClass}
            value={data.purpose}
            onChange={(e) => onChange({ purpose: e.target.value })}
          />
        </Field>
        <Field id="effective-date" label="Effective date">
          <input
            id="effective-date"
            type="date"
            className={inputClass}
            value={data.effectiveDate}
            onChange={(e) => onChange({ effectiveDate: e.target.value })}
          />
        </Field>
      </Fieldset>

      <Fieldset legend="MNDA term">
        <div className="flex items-center gap-2">
          <RadioOption
            name="term-type"
            checked={data.termType === "expires"}
            onSelect={() => onChange({ termType: "expires" })}
          >
            Expires after
          </RadioOption>
          <YearsInput
            id="term-years"
            value={data.termYears}
            disabled={data.termType !== "expires"}
            onChange={(termYears) => onChange({ termYears })}
          />
          <span className="text-sm text-gray-800">year(s)</span>
        </div>
        <RadioOption
          name="term-type"
          checked={data.termType === "continues"}
          onSelect={() => onChange({ termType: "continues" })}
        >
          Continues until terminated
        </RadioOption>
      </Fieldset>

      <Fieldset legend="Term of confidentiality">
        <div className="flex items-center gap-2">
          <RadioOption
            name="confidentiality-type"
            checked={data.confidentialityType === "years"}
            onSelect={() => onChange({ confidentialityType: "years" })}
          >
            Protected for
          </RadioOption>
          <YearsInput
            id="confidentiality-years"
            value={data.confidentialityYears}
            disabled={data.confidentialityType !== "years"}
            onChange={(confidentialityYears) => onChange({ confidentialityYears })}
          />
          <span className="text-sm text-gray-800">year(s)</span>
        </div>
        <RadioOption
          name="confidentiality-type"
          checked={data.confidentialityType === "perpetuity"}
          onSelect={() => onChange({ confidentialityType: "perpetuity" })}
        >
          In perpetuity
        </RadioOption>
      </Fieldset>

      <Fieldset legend="Governing law & jurisdiction">
        <Field id="governing-law" label="Governing law (state)">
          <input
            id="governing-law"
            className={inputClass}
            placeholder="e.g. Delaware"
            value={data.governingLaw}
            onChange={(e) => onChange({ governingLaw: e.target.value })}
          />
        </Field>
        <Field
          id="jurisdiction"
          label="Jurisdiction (city or county and state)"
          hint="Shown as “courts located in …”."
        >
          <input
            id="jurisdiction"
            className={inputClass}
            placeholder="e.g. New Castle, DE"
            value={data.jurisdiction}
            onChange={(e) => onChange({ jurisdiction: e.target.value })}
          />
        </Field>
      </Fieldset>

      <Fieldset legend="MNDA modifications">
        <Field
          id="modifications"
          label="Modifications"
          hint="Optional. Changes to the Standard Terms; these control over conflicts."
        >
          <textarea
            id="modifications"
            rows={3}
            className={inputClass}
            value={data.modifications}
            onChange={(e) => onChange({ modifications: e.target.value })}
          />
        </Field>
      </Fieldset>

      <PartyFields
        prefix="party1"
        legend="Party 1"
        party={data.party1}
        onChange={(patch) => onPartyChange("party1", patch)}
      />
      <PartyFields
        prefix="party2"
        legend="Party 2"
        party={data.party2}
        onChange={(patch) => onPartyChange("party2", patch)}
      />
    </form>
  );
}
