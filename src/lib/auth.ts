import axios from "axios";

export type SessionUser = { id: string; email: string; role?: string };

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
    return { id: fromUser.id, email: fromUser.email, role: fromUser.role ?? maybe.role };
  }

  if (maybe.id && maybe.email) {
    return { id: maybe.id, email: maybe.email, role: maybe.role };
  }

  if (maybe.user_id && maybe.email) {
    return { id: maybe.user_id, email: maybe.email, role: maybe.role };
  }

  return null;
}

export async function login(email: string, password: string) {
  const form = new URLSearchParams();
  form.append("username", email);   // FastAPI expects "username"
  form.append("password", password);

  const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  const { data } = await axios.post(`${base}/auth/token`, form, {
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
      const { data: meData } = await axios.get(`${base}/auth/me`, {
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
