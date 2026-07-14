import type { Context } from "hono";
import crypto from "node:crypto";

export async function verifyGithubSignature(c: Context) {
  const signature = c.req.header("X-Hub-Signature-256");

  const event = c.req.header("X-GitHub-Event");

  if (event !== "push") {
    return c.text("Ignored");
  }

  if (!signature) return false;

  const body = await c.req.text();

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET!)
      .update(body)
      .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
