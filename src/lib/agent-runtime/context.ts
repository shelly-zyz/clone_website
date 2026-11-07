import { z } from "zod";

export const sessionInput = {
  project_id: z.uuid(),
  session_id: z.uuid(),
  revision: z.number().int().min(0).max(2147483646),
};

export const openSessionSchema = z.strictObject({ action: z.literal("create_session"), project_id: z.uuid() });
export const getSessionSchema = z.strictObject({
  action: z.literal("get_session"), project_id: z.uuid(), session_id: z.uuid(),
});
