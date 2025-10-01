// Server component
import { Suspense } from "react";
import ResetCompleteClient from "./Client";

interface ResetCompletePageProps {
  searchParams?: { token?: string | string[] };
}

export default function ResetCompletePage({ searchParams }: ResetCompletePageProps) {
  const raw = searchParams?.token;
  const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        {/* Always render the client with a string, even if empty */}
        <ResetCompleteClient token={token} />
      </Suspense>
    </div>
  );
}