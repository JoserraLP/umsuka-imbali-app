import { z } from "zod";

export const registerForEventSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
});
export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;

/**
 * `userId` is optional: omitted means "unregister myself". Providing a
 * different userId is only honored by the mutation when the actor holds
 * a management role — enforced server-side in unregisterFromEvent(),
 * never trusted from the client.
 */
export const unregisterFromEventSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  userId: z.string().uuid("El ID del usuario debe ser un UUID válido.").optional(),
});
export type UnregisterFromEventInput = z.infer<typeof unregisterFromEventSchema>;
