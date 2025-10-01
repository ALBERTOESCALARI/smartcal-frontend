// src/app/auth/reset-complete/[token]/page.tsx
"use client";

import ResetCompleteClient from "../Client";

export default function ResetCompletePathPage({
  params,
}: {
  params: { token?: string };
}) {
  const token = params?.token || "";
  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <p className="text-red-500 font-semibold">Invalid or missing reset link.</p>
      </div>
    );
  }
  return <ResetCompleteClient token={token} />;
}