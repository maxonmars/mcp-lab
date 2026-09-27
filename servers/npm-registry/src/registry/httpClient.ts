import { NpmRegistryError } from "./errors.ts";

export async function fetchJson(url: URL, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } catch {
    throw new NpmRegistryError("NETWORK_FAILED");
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) throw new NpmRegistryError("PACKAGE_NOT_FOUND");
  if (!response.ok) throw new NpmRegistryError("BAD_STATUS");
  try {
    return await response.json();
  } catch {
    throw new NpmRegistryError("INVALID_PAYLOAD");
  }
}
