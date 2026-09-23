export type FilesystemDiscoveryOptions = Readonly<{
  root: string;
  timeoutMs: number;
  nodeExecutable: string;
}>;

export type McpToolSummary = Readonly<{
  name: string;
  description?: string;
}>;

export type McpDiscoveryResult = Readonly<{
  server: Readonly<{
    name: string;
    version: string;
  }>;
  tools: readonly McpToolSummary[];
}>;
