import { z } from "zod/v4";
import { NPM_REGISTRY_HOST } from "./constants.ts";
import { NpmRegistryError } from "./errors.ts";
import type { NpmPackageInfo } from "./format.ts";
import { fetchJson } from "./httpClient.ts";
import { parseGithubRepository } from "./repository.ts";
import type { NpmRegistryDependencies } from "./types.ts";

const repositorySchema = z.union([z.string(), z.object({ url: z.string() })]);

const payloadSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  repository: repositorySchema.optional(),
});

/** @scope/pkg → @scope%2Fpkg; иначе encodeURIComponent — обе формы отвечают 200 у registry.npmjs.org. */
function registryPath(name: string): string {
  return name.startsWith("@") ? name.replace("/", "%2F") : encodeURIComponent(name);
}

export async function fetchNpmPackage(name: string, deps: NpmRegistryDependencies): Promise<NpmPackageInfo> {
  const url = new URL(`${NPM_REGISTRY_HOST}/${registryPath(name)}/latest`);
  const payload = await fetchJson(url, deps.fetchImpl, deps.timeoutMs);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new NpmRegistryError("INVALID_PAYLOAD");
  const data = parsed.data;
  const repositoryUrl = typeof data.repository === "string" ? data.repository : data.repository?.url;
  return {
    name: data.name,
    version: data.version,
    description: data.description,
    license: data.license,
    homepage: data.homepage,
    repositoryUrl,
    repository: repositoryUrl ? parseGithubRepository(repositoryUrl) : undefined,
  };
}
