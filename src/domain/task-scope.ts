/** Founder decision 44: household tasks are practical coordination, never medical orders or legal steps. */
/**
 * Words that mark a medical order or a legal obligation (decision 44). Checked on household tasks and the
 * task catalog. A guard rail, not a guarantee.
 */
export const OUT_OF_SCOPE =
  /\b(dose|dosage|\d+\s?mg|prescri\w*|administer\w*|medicat\w*|morphine|insulin|inject\w*|DNR|POLST|resuscitat\w*|power of attorney|sign (?:the |a )?will|legally binding)\b/i;
export const OUT_OF_SCOPE_MESSAGE =
  "Zeporah tasks are for practical coordination. Medical orders and legal steps go through your care team — message them instead.";

