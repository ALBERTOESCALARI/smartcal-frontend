import { Suspense } from "react";
import LoginForm from "./LoginForm";

interface LoginPageProps {
  searchParams?: { reason?: string | string[] };
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const rawReason = searchParams?.reason;
  const reason = Array.isArray(rawReason) ? rawReason[0] : rawReason;

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LoginForm reason={reason ?? undefined} />
      </Suspense>
    </div>
  );
}
