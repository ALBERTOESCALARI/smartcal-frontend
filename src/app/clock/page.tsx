"use client";

import ClockControls from "@/components/time/clock-controls";
import { useEffect, useState } from "react";

interface Me {
  id: string;
  role?: string;
}

export default function ClockPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const base = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
        const tenantId = typeof window !== "undefined" ? localStorage.getItem("tenant_id") : null;

        if (!token) {
          if (mounted) {
            setMe(null);
            setLoading(false);
          }
          return;
        }

        const res = await fetch(`${base}/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(tenantId ? { "X-Tenant-ID": tenantId } : {}),
          },
          credentials: "include",
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `Failed to load user (${res.status})`);
        }

        const user = (await res.json()) as Me;
        if (mounted) setMe(user);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load user");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Clock</h1>
        <p>Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Clock</h1>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Clock</h1>
        <p>Not signed in.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Clock In / Out</h1>
      <ClockControls
        currentUserId={me.id}
        currentUserRole={me.role as any}
        // No shift context here; members clock in from Shifts when assigned
        shiftId={undefined}
        assignedUserId={null}
      />
    </div>
  );
}