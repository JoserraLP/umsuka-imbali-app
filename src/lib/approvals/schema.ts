import { z } from "zod";

/**
 * Schema for approving a pending user.
 * Only super_admin and admin can perform this action.
 */
export const approveUserSchema = z.object({
  userId: z.string().uuid("userId debe ser un UUID válido."),
});

export type ApproveUserInput = z.infer<typeof approveUserSchema>;

/**
 * Schema for suspending an active/pending user.
 * Only super_admin and admin can perform this action.
 */
export const suspendUserSchema = z.object({
  userId: z.string().uuid("userId debe ser un UUID válido."),
});

export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
