import axios from "axios";


export type SessionUser = { id: string; email: string; role?: "admin" | "member" | "scheduler" };

function normalizeRole(r?: string): SessionUser["role"] {
  if (!r) return undefined;
  const v = r.toLowerCase();
  return v === "admin" || v === "member" || v === "scheduler" ? (v as SessionUser["role"]) : undefined;
}

function saveSessionUser(u: SessionUser) {
  try {
    localStorage.setItem("session_user", JSON.stringify(u));
  } catch {}
}

export function loadSessionUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("session_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSessionUser() {
  try { localStorage.removeItem("session_user"); } catch {}
}

function buildSessionUser(data: unknown): SessionUser | null {
  if (!data || typeof data !== "object") return null;

  const maybe = data as {
    id?: string;
    user?: { id?: string; email?: string; role?: string };
    user_id?: string;
    email?: string;
    role?: string;
  };

  const fromUser = maybe.user;
  if (fromUser?.id && fromUser?.email) {
    return { id: fromUser.id, email: fromUser.email, role: normalizeRole(fromUser.role ?? maybe.role) };
  }

  if (maybe.id && maybe.email) {
    return { id: maybe.id, email: maybe.email, role: normalizeRole(maybe.role) };
  }

  if (maybe.user_id && maybe.email) {
    return { id: maybe.user_id, email: maybe.email, role: normalizeRole(maybe.role) };
  }

  return null;
}

export async function login(email: string, password: string) {
  const form = new URLSearchParams();
  form.append("username", email);   // FastAPI expects "username"
  form.append("password", password);

  const envBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "";
  const base = envBase.replace(/\/+$/, "");
  const tokenUrl = base ? `${base}/auth/token` : "/auth/token";

  const { data } = await axios.post(tokenUrl, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const token = data?.access_token;
  if (!token) {
    throw new Error("Missing access token in response");
  }

  localStorage.setItem("token", token);
  clearSessionUser();

  let sessionUser = buildSessionUser(data);

  if (!sessionUser) {
    try {
      const meUrl = base ? `${base}/auth/me` : "/auth/me";
      const { data: meData } = await axios.get(meUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      sessionUser = buildSessionUser(meData);
    } catch {}
  }

  if (sessionUser) {
    saveSessionUser(sessionUser);
  }

  return data;
}

export function logout() {
  localStorage.removeItem("token");
  clearSessionUser();
}

export function isAuthed(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("token");
}
