import { z } from "zod/v4";
import { GITHUB_API_HOST } from "./constants.ts";
import { GithubApiError } from "./errors.ts";
import type { GithubRelease, GithubReleaseDetails, GithubReleaseList } from "./format.ts";
import { fetchGithubJson } from "./request.ts";
import type { GithubApiDependencies } from "./types.ts";

const releaseApiSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  prerelease: z.boolean().optional(),
  draft: z.boolean().optional(),
  html_url: z.string(),
});
const releaseWithBodyApiSchema = releaseApiSchema.extend({ body: z.string().nullable().optional() });

function toRelease(item: z.infer<typeof releaseApiSchema>): GithubRelease {
  return {
    tag: item.tag_name,
    ...(item.name ? { name: item.name } : {}),
    ...(item.published_at ? { publishedAt: item.published_at } : {}),
    prerelease: item.prerelease === true,
    htmlUrl: item.html_url,
  };
}

export async function listGithubReleases(
  owner: string,
  repo: string,
  limit: number,
  deps: GithubApiDependencies,
): Promise<GithubReleaseList> {
  const url = new URL(`${GITHUB_API_HOST}/repos/${owner}/${repo}/releases`);
  url.searchParams.set("per_page", String(limit));
  const payload = await fetchGithubJson(url, deps.fetchImpl, deps.timeoutMs, "list");
  const parsed = z.array(releaseApiSchema).safeParse(payload);
  if (!parsed.success) throw new GithubApiError("INVALID_PAYLOAD");
  return { owner, repo, releases: parsed.data.filter((item) => item.draft !== true).map(toRelease) };
}

export async function getGithubRelease(
  owner: string,
  repo: string,
  tag: string,
  deps: GithubApiDependencies,
): Promise<GithubReleaseDetails> {
  const url = new URL(`${GITHUB_API_HOST}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  const payload = await fetchGithubJson(url, deps.fetchImpl, deps.timeoutMs, "release");
  const parsed = releaseWithBodyApiSchema.safeParse(payload);
  if (!parsed.success) throw new GithubApiError("INVALID_PAYLOAD");
  const body = parsed.data.body?.trim();
  return { ...toRelease(parsed.data), owner, repo, ...(body ? { body } : {}) };
}
