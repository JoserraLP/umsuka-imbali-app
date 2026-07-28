import { z } from "zod";

export const registerForEventSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
});
export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;

/**
 * `userId` is optional: omitted means "unregister myself". Providing a
 * different userId is only honored by the mutation when the actor holds
 * a management role — enforced server-side in unregisterFromEvent(),
 * never trusted from the client.
 */
export const unregisterFromEventSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
  userId: z.string().uuid("userId must be a valid UUID.").optional(),
});
export type UnregisterFromEventInput = z.infer<typeof unregisterFromEventSchema>;
