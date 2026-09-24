import { z } from "zod/v4";

export const observationSchema = z.object({
  observedAtUtc: z.string().min(1),
  observedAtLocal: z.string().min(1),
  locationName: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  temperature: z.number(),
  apparentTemperature: z.number(),
  relativeHumidity: z.number(),
  precipitation: z.number(),
  windSpeed: z.number(),
  condition: z.string(),
});

export const pollResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), observation: observationSchema }),
  z.object({ ok: z.literal(false), error: z.string().trim().min(1).max(300) }),
]);

export const historyRowSchema = z.object({
  requestedAtMs: z.number(),
  ok: z.boolean(),
  error: z.string().optional(),
  observedAtUtc: z.string().optional(),
  temperature: z.number().optional(),
  condition: z.string().optional(),
});

export const timestamp = z.number().int().nonnegative();
