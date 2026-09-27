import { GithubApiError, type GithubApiErrorCode, type GithubStage } from "./errors.ts";

const NOT_FOUND_ERRORS: Readonly<Record<GithubStage, GithubApiErrorCode>> = {
  list: "REPOSITORY_NOT_FOUND",
  release: "RELEASE_NOT_FOUND",
};

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
}

/** User-Agent обязателен: без него GitHub REST API отклоняет запрос. Токена и Authorization нет. */
export async function fetchGithubJson(
  url: URL,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  stage: GithubStage,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mcp-lab-github-releases",
      },
    });
  } catch {
    throw new GithubApiError("NETWORK_FAILED");
  } finally {
    clearTimeout(timer);
  }
  if (isRateLimited(response)) throw new GithubApiError("RATE_LIMITED");
  if (response.status === 404) throw new GithubApiError(NOT_FOUND_ERRORS[stage]);
  if (!response.ok) throw new GithubApiError("BAD_STATUS");
  try {
    return await response.json();
  } catch {
    throw new GithubApiError("INVALID_PAYLOAD");
  }
}
