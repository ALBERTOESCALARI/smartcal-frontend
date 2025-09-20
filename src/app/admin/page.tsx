"use client";
import RequireSuperadmin from "@/components/require-superadmin";
import Link from "next/link";

export default function AdminHome() {
  return (
    <RequireSuperadmin>
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <ul className="list-disc pl-6 space-y-2">
          <li><Link className="underline" href="/admin/tenants">Tenants</Link></li>
        </ul>
      </div>
    </RequireSuperadmin>
  );
}