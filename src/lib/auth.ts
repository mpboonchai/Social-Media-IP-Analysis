import crypto from "node:crypto";
import { cookies } from "next/headers";

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  role: "master_admin" | "viewer";
}

const COOKIE_NAME = "smip_session";
const TTL_SECONDS = 60 * 60 * 12; // 12 hours

function getSecret(): string {
  return process.env.SESSION_SECRET || "dev-social-media-ip-analysis-v2-local-secret-key-2026";
}

export function signSession(user: SessionUser): string {
  const payload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      id: Number(parsed.id),
      username: String(parsed.username),
      display_name: String(parsed.display_name),
      role: parsed.role === "master_admin" ? "master_admin" : "viewer",
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySessionToken(store.get(COOKIE_NAME)?.value);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_TTL_SECONDS = TTL_SECONDS;
