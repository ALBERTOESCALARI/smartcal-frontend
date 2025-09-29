"use client";

import RequireAuth from "@/components/require-auth";
import ClockControls from "@/components/time/clock-controls";
import { Card } from "@/components/ui/card";
import { loadSessionUser, type SessionUser } from "@/lib/auth";
import { useEffect, useState } from "react";

export default function ClockPage() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSessionUser(loadSessionUser());
    setHydrated(true);
  }, []);

  const canRenderControls = Boolean(sessionUser?.id);

  return (
    <RequireAuth>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Clock In / Out</h1>
          <p className="text-sm text-slate-600">
            Location access is required so we can enforce geofencing for your shift.
          </p>
        </header>

        <Card className="p-4">
          {hydrated && canRenderControls ? (
            <ClockControls
              currentUserId={sessionUser!.id}
              currentUserRole={sessionUser!.role}
              className="w-full"
            />
          ) : (
            <p className="text-sm text-slate-500">Loading your profile…</p>
          )}
        </Card>
      </main>
    </RequireAuth>
  );
}

