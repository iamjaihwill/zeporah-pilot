/**
 * Submission IDs (brief reconciliation increment 3). A device makes one ID per send and keeps it
 * until the server confirms that send, so a retry after a lost reply is recognised as the same
 * send (services/send-once.ts). The ID says nothing about the person or the content.
 */
import { z } from "zod";

export const submissionId = z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "Not a submission ID.");

/** A new random ID (a UUID: available in every supported browser on https and localhost). */
export const newSubmissionId = () => crypto.randomUUID();
