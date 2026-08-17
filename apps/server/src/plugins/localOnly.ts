// CSRF guard for state-changing routes on this localhost-only server:
// block requests with a non-local Origin, and block browser requests that
// omit Origin but self-identify as cross-site via Sec-Fetch-Site.
// Header-less local scripts (curl) remain allowed — the documented accepted
// risk for a personal local tool.
import type { FastifyReply, FastifyRequest } from "fastify";

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function localOnly(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const origin = (req.headers.origin as string) ?? "";
  const sfs = (req.headers["sec-fetch-site"] as string) ?? "";
  if (origin && !LOCAL_ORIGIN.test(origin)) {
    reply.code(403).send({ error: "cross-origin" });
    return;
  }
  if (!origin && (sfs === "cross-site" || sfs === "same-site")) {
    reply.code(403).send({ error: "cross-origin" });
    return;
  }
  done();
}
