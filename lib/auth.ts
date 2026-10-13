/** Single-user access: a password sets a signed session cookie. */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pianola_session";
export const SESSION_DAYS = 180;

function secret(name: "AUTH_SECRET" | "WORKER_SECRET"): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function sign(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeSession(): string {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${sign(secret("AUTH_SECRET"), `session:${exp}`)}`;
}

export function verifySession(value: string | undefined): boolean {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(secret("AUTH_SECRET"), `session:${exp}`));
}

export function checkPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return safeEqual(sign("pw", password.trim()), sign("pw", expected));
}

/** The ntfy.sh topic the browser and the PC worker talk over (the worker derives the same name). */
export function ntfyTopic(): string {
  return "pianola-" + sign(secret("WORKER_SECRET"), "ntfy-topic").slice(0, 24);
}
