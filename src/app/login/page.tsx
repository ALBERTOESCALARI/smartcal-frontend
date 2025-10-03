import { Suspense } from "react";
import LoginForm from "./LoginForm";

interface LoginPageProps {
  searchParams?: { reason?: string | string[]; tenant_id?: string | string[]; tenant?: string | string[] };
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const rawReason = searchParams?.reason;
  const reason = Array.isArray(rawReason) ? rawReason[0] : rawReason;

  // pick up tenant id from either ?tenant_id= or ?tenant=
  const rawTenant = searchParams?.tenant_id ?? searchParams?.tenant;
  const initialTenantId = Array.isArray(rawTenant) ? rawTenant[0] : rawTenant;

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LoginForm reason={reason ?? undefined} initialTenantId={initialTenantId ?? undefined} />
      </Suspense>
    </div>
  );
}