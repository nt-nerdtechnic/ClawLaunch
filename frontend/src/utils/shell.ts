/**
 * Escapes a string for use in shell commands.
 * This is used to ensure that user-provided strings don't break shell commands
 * or lead to command injection.
 */
export const shellQuote = (s: string): string => {
  if (typeof s !== 'string') return s;
  if (!s) return "''";
  // If the string contains any characters that are not alphanumeric or common safe characters,
  // wrap it in single quotes and escape any internal single quotes.
  if (/[^\w@%\-+=:,./]/.test(s)) {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }
  return s;
};
