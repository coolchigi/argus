import { serverFieldError } from "./correction-form.ts";

// Copy for the error codes POST /impacts/{id}/correction returns: the
// guardrail refusals (422) and the verdict-change checks (400). Other codes
// keep the message the form already showed.
const ERROR_COPY: Record<string, string> = {
  "correction-contains-personal-information":
    "This correction mentions personal details, so Argus can't store it. Refer to the client by their file number only.",
  "correction-blocked-by-guardrail":
    "Argus's safety filter flagged this correction, so it wasn't saved. Reword it and try again.",
};

export function describeCorrectionError(code: string): string {
  return ERROR_COPY[code] ?? serverFieldError(code)?.message ?? code;
}
