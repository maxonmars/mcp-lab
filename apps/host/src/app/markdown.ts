import { readFileSync } from "node:fs";

export function sections(url: URL): Record<string, string> {
  return Object.fromEntries(
    readFileSync(url, "utf8")
      .split(/^## /m)
      .slice(1)
      .map((section) => {
        const [id, ...lines] = section.split("\n");
        return [id?.trim(), lines.join("\n").trim()];
      }),
  );
}
