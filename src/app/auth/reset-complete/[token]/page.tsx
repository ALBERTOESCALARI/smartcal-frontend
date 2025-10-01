// Server component for /auth/reset-complete/[token]
import { Suspense } from "react";
import ResetCompleteClient from "../Client";

interface ResetCompletePathProps {
  params: { token: string };
}

export default function ResetCompletePathPage({ params }: ResetCompletePathProps) {
  const token = params.token ?? "";

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ResetCompleteClient token={token} />
      </Suspense>
    </div>
  );
}