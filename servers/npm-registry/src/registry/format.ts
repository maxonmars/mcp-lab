import { z } from "zod/v4";
import { repositoryDisplayUrl } from "./repository.ts";

export const npmPackageInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  repositoryUrl: z.string().optional(),
  repository: z.object({ owner: z.string(), repo: z.string() }).optional(),
});

export type NpmPackageInfo = z.infer<typeof npmPackageInfoSchema>;

function repositoryLines(info: NpmPackageInfo): string[] {
  if (!info.repositoryUrl) return ["GitHub: репозиторий не указан или размещён не на GitHub."];
  return [
    `Репозиторий: ${repositoryDisplayUrl(info.repositoryUrl, info.repository)}`,
    info.repository
      ? `GitHub: owner=${info.repository.owner}, repo=${info.repository.repo}`
      : "GitHub: репозиторий не указан или размещён не на GitHub.",
  ];
}

export function formatNpmPackageText(info: NpmPackageInfo): string {
  const lines = [`Пакет npm: ${info.name}`, `Последняя версия (dist-tag latest): ${info.version}`];
  if (info.description) lines.push(`Описание: ${info.description}`);
  if (info.license) lines.push(`Лицензия: ${info.license}`);
  if (info.homepage) lines.push(`Домашняя страница: ${info.homepage}`);
  lines.push(...repositoryLines(info));
  return lines.join("\n");
}
