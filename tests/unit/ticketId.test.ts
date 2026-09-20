import { describe, expect, it } from "vitest";
import { MAX_TICKET_ID_LENGTH, isValidTicketId } from "@/lib/orchestrator/ticketId";

describe("isValidTicketId (a Server Action argument is untrusted input)", () => {
  it("accepts a normal cuid-style id and anything up to the bound", () => {
    expect(isValidTicketId("cmu9h306a0000abcd1234efgh")).toBe(true);
    expect(isValidTicketId("x")).toBe(true);
    expect(isValidTicketId("a".repeat(MAX_TICKET_ID_LENGTH))).toBe(true);
  });

  it("rejects empty and over-long strings", () => {
    expect(isValidTicketId("")).toBe(false);
    expect(isValidTicketId("a".repeat(MAX_TICKET_ID_LENGTH + 1))).toBe(false);
    expect(isValidTicketId("a".repeat(100_000))).toBe(false);
  });

  it.each([undefined, null, 42, {}, [], ["id"], { id: "x" }, true, Symbol("x")])("rejects the non-string %s", (value) => {
    expect(isValidTicketId(value)).toBe(false);
  });
});
