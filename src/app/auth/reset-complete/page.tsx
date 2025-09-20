import { Suspense } from "react";
import ResetCompleteClient from "./Client";

interface ResetCompletePageProps {
  searchParams?: { token?: string | string[] };
}

export default function ResetCompletePage({
  searchParams,
}: ResetCompletePageProps) {
  const rawToken = searchParams?.token;
  const token = Array.isArray(rawToken) ? rawToken[0] ?? "" : rawToken ?? "";

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ResetCompleteClient token={token} />
      </Suspense>
    </div>
  );
}
