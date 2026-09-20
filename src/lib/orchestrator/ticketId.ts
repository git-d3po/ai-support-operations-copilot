/** The longest ticket id accepted from a client (real ids are 25-character cuids). */
export const MAX_TICKET_ID_LENGTH = 64;

/**
 * A ticket id arrives from the browser as a Server Action argument, so it is
 * validated as a bounded, non-empty string before anything touches the database.
 * Validity says nothing about whether the ticket exists.
 */
export function isValidTicketId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TICKET_ID_LENGTH;
}
