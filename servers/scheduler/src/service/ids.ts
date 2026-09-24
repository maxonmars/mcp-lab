import { randomBytes } from "node:crypto";

export function generateScheduleId(): string {
  return `sch_${randomBytes(4).toString("hex")}`;
}
