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

export async function login(email: string, password: string) {
  const form = new URLSearchParams();
  form.append("username", email);   // FastAPI expects "username"
  form.append("password", password);

  const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  const { data } = await axios.post(`${base}/auth/token`, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  localStorage.setItem("token", data.access_token);
  if (data.user?.id && data.user?.email) {
    saveSessionUser({ id: data.user.id, email: data.user.email, role: data.user.role });
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