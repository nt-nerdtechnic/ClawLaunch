/** Shell sub-command shared types */

export type CommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};
