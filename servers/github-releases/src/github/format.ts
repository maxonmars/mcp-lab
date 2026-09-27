import { z } from "zod/v4";
import { MAX_RELEASE_NOTES_CHARS } from "./constants.ts";

export const githubReleaseSchema = z.object({
  tag: z.string(),
  name: z.string().optional(),
  publishedAt: z.string().optional(),
  prerelease: z.boolean(),
  htmlUrl: z.string(),
});
export type GithubRelease = z.infer<typeof githubReleaseSchema>;

export const githubReleaseListOutputSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  releases: z.array(githubReleaseSchema),
});
export type GithubReleaseList = z.infer<typeof githubReleaseListOutputSchema>;

export const githubReleaseDetailsSchema = githubReleaseSchema.extend({
  owner: z.string(),
  repo: z.string(),
  body: z.string().optional(),
});
export type GithubReleaseDetails = z.infer<typeof githubReleaseDetailsSchema>;

function releaseLine(release: GithubRelease): string {
  const title = release.name ?? release.tag;
  const published = release.publishedAt ?? "дата не указана";
  const prerelease = release.prerelease ? ", предварительный" : "";
  return `- ${release.tag} — «${title}», опубликован ${published}${prerelease} — ${release.htmlUrl}`;
}

export function formatReleaseListText(list: GithubReleaseList): string {
  const fullName = `${list.owner}/${list.repo}`;
  if (list.releases.length === 0) return `У репозитория ${fullName} нет опубликованных релизов GitHub.`;
  const header = `Релизы GitHub ${fullName} (показано ${list.releases.length}, новые сначала):`;
  return [header, ...list.releases.map(releaseLine)].join("\n");
}

function notesText(body: string | undefined): string {
  if (!body) return "Заметки к релизу: отсутствуют (GitHub вернул пустое описание).";
  if (body.length <= MAX_RELEASE_NOTES_CHARS) return `Заметки к релизу:\n${body}`;
  const truncated = body.slice(0, MAX_RELEASE_NOTES_CHARS);
  return `Заметки к релизу:\n${truncated}\n[Заметки обрезаны: показано ${MAX_RELEASE_NOTES_CHARS} из ${body.length} символов.]`;
}

export function formatReleaseDetailsText(details: GithubReleaseDetails): string {
  return [
    `Релиз GitHub ${details.owner}/${details.repo} ${details.tag}`,
    `Название: ${details.name ?? details.tag}`,
    `Опубликован: ${details.publishedAt ?? "дата не указана"}`,
    `Ссылка: ${details.htmlUrl}`,
    "",
    notesText(details.body),
  ].join("\n");
}
