/** Runs once when the server starts: refuse to boot without a strong SESSION_SECRET. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getSessionSecret } = await import("./lib/env");
    getSessionSecret();
  }
}
