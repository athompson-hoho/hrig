export const hostPlatform =
  typeof window !== "undefined" ? window.hrig?.platform || "win32" : "win32";
export const isWindows = hostPlatform === "win32";
export function localShellLabel(choice: string) {
  if (!isWindows)
    return choice === "bash"
      ? "Bash"
      : choice === "zsh"
        ? "Zsh"
        : "Login shell";
  return choice === "cmd" ? "Command Prompt" : "Windows PowerShell";
}
