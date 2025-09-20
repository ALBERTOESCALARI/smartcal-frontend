"use client";

import RequireAuth from "@/components/require-auth";
import { Card } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <RequireAuth>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">Welcome! This will show quick stats.</Card>
          <Card className="p-4">Today’s shifts / alerts.</Card>
          <Card className="p-4 md:col-span-2">Recent requests (PTO & swaps).</Card>
        </div>
    </RequireAuth>
  );
}
