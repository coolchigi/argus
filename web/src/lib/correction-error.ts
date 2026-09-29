// Copy for the error codes POST /impacts/{id}/correction returns when the
// Argus guardrail refuses the correction text. Other codes keep the message
// the form already showed.
const ERROR_COPY: Record<string, string> = {
  "correction-contains-personal-information":
    "This correction mentions personal details, so Argus can't store it. Refer to the client by their file number only.",
  "correction-blocked-by-guardrail":
    "Argus's safety filter flagged this correction, so it wasn't saved. Reword it and try again.",
};

export function describeCorrectionError(code: string): string {
  return ERROR_COPY[code] ?? code;
}
