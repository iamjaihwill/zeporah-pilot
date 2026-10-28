/**
 * The hospice's 24-hour clinical line (founder decision 72): what counts as a well-formed number,
 * and when it's due to be confirmed again. A well-formed number isn't a working one: only a person
 * calling it confirms that (services/contact-line.ts).
 */

/** Re-confirm at least this often (decision 72). */
export const RECONFIRM_DAYS = 90;

/**
 * A US phone number, optionally with an extension, optionally followed by a short label:
 * "(555) 555-0100", "1-555-555-0100 ext. 2", "555-555-0100, press 1 for the nurse line".
 */
const LINE =
  /^\s*(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,6})?(?:\s*(?:[,(]|—|–|-)\s*[^]{1,60})?\s*$/i;

export const LINE_FORMAT_MESSAGE =
  "Enter a US phone number with its area code, for example (555) 555-0100. You can add an extension or a short note after a comma.";

export const isWellFormedLine = (text: string) => text.trim().length <= 80 && LINE.test(text);

/** Families see the line, and the backup in brackets when there is one. */
export const lineForFamilies = (line: string, backup: string | null) =>
  backup ? `${line} (if you can't get through: ${backup})` : line;

export function confirmationDue(lastConfirmedAt: Date | null, now = new Date()) {
  if (!lastConfirmedAt) return { dueAt: null, due: true };
  const dueAt = new Date(lastConfirmedAt.getTime() + RECONFIRM_DAYS * 86_400_000);
  return { dueAt, due: dueAt <= now };
}
