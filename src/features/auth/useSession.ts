"use client";

import { useQuery } from "@tanstack/react-query";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  employee_id?: string;
  role?: string;
}

async function fetchMe(): Promise<SessionUser | null> {
  if (typeof window === "undefined") return null;

  const token = localStorage.getItem("token");
  if (!token) return null;

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.user) return null;
  return {
    ...data.user,
    name: data.name,
    employee_id: data.employee_id,
    role: data.role,
  };
}

export function useSession() {
  return useQuery<SessionUser | null>({
    queryKey: ["session"],
    queryFn: fetchMe,
  });
}
