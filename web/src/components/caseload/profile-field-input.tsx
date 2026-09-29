"use client";

import { SectionLabel } from "@/components/argus/section-label";
import { fieldClass } from "./copy";
import type { ProfileField } from "./profile-fields";

type Props = {
  id: string;
  field: ProfileField;
  value: string;
  onChange: (value: string) => void;
};

/** One profile attribute as a labelled input. Blank always means "not set". */
export function ProfileFieldInput({ id, field, value, onChange }: Props) {
  const { input } = field;
  return (
    <div className="space-y-1.5">
      <SectionLabel as="label" htmlFor={id}>
        {field.label}
      </SectionLabel>
      {input.kind === "enum" || input.kind === "bool" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
          <option value="">Not set</option>
          {(input.kind === "bool"
            ? [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]
            : input.options
          ).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : input.kind === "date" ? (
        <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} font-mono`} />
      ) : input.kind === "code" ? (
        <input
          id={id}
          value={value}
          pattern={input.pattern}
          placeholder={input.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className={`${fieldClass} font-mono`}
        />
      ) : (
        <input
          id={id}
          type="number"
          inputMode={input.kind === "int" ? "numeric" : "decimal"}
          min={input.min}
          max={input.max}
          step={input.kind === "int" ? 1 : "any"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${fieldClass} font-mono`}
        />
      )}
    </div>
  );
}
