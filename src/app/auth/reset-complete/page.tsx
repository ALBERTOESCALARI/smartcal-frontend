import { Suspense } from "react";
import ResetCompleteClient from "./Client";

export default function ResetCompletePage() {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ResetCompleteClient />
      </Suspense>
    </div>
  );
}
