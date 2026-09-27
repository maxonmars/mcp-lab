export type NpmRepository = Readonly<{ owner: string; repo: string }>;

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function toRepository(owner: string | undefined, repo: string | undefined): NpmRepository | undefined {
  return owner && repo ? { owner, repo: stripGitSuffix(repo) } : undefined;
}

function fromGithubShorthand(value: string): NpmRepository | undefined {
  const match = /^github:([^/]+)\/([^/]+)$/.exec(value);
  return match ? toRepository(match[1], match[2]) : undefined;
}

function fromScpLike(value: string): NpmRepository | undefined {
  const match = /^git@github\.com:([^/]+)\/([^/]+)$/.exec(value);
  return match ? toRepository(match[1], match[2]) : undefined;
}

function fromUrl(value: string): NpmRepository | undefined {
  let url: URL;
  try {
    url = new URL(value.replace(/^git\+/, ""));
  } catch {
    return undefined;
  }
  if (url.hostname !== "github.com") return undefined;
  const [owner, repo] = url.pathname.replace(/^\//, "").split("/");
  return toRepository(owner, repo);
}

function fromOwnerRepoShorthand(value: string): NpmRepository | undefined {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(value);
  return match ? toRepository(match[1], match[2]) : undefined;
}

/** Не-GitHub значение (в том числе неразбираемый URL) возвращает undefined — вызывающий сохраняет исходную строку. */
export function parseGithubRepository(value: string): NpmRepository | undefined {
  return fromGithubShorthand(value) ?? fromScpLike(value) ?? fromUrl(value) ?? fromOwnerRepoShorthand(value);
}

/** Для GitHub — канонический https-URL; иначе исходное значение без префикса git+. */
export function repositoryDisplayUrl(value: string, github: NpmRepository | undefined): string {
  return github ? `https://github.com/${github.owner}/${github.repo}` : value.replace(/^git\+/, "");
}
