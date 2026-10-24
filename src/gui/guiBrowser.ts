import { spawn } from "node:child_process";

/** Launch the caller's default browser at the loopback GUI URL. */
export const openGuiInBrowser = (
  url: string,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  const [command, args] =
    platform === "win32"
      ? (["cmd", ["/c", "start", "", url]] as const)
      : platform === "darwin"
        ? (["open", [url]] as const)
        : (["xdg-open", [url]] as const);
  try {
    const child = spawn(command, [...args], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
};
