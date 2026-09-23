export type StdioToolSourceOptions = Readonly<{
  command: string;
  args: readonly string[];
  timeoutMs: number;
}>;
