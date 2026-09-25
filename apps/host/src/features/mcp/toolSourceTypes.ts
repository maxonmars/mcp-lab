export type StdioToolSourceOptions = Readonly<{
  command: string;
  args: readonly string[];
  /** Таймаут подключения, списка и вызовов без отдельного значения в callTimeoutsMs. */
  timeoutMs: number;
  /** Добавляется к безопасному набору переменных SDK; остальное окружение host не наследуется. */
  env?: Readonly<Record<string, string>> | undefined;
  callTimeoutsMs?: Readonly<Record<string, number>> | undefined;
}>;
