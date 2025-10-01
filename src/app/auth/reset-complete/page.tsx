import ResetCompleteClient from "./Client";

export default function ResetCompleteQueryPage({
  searchParams,
}: {
  searchParams?: { token?: string | string[] };
}) {
  const raw = searchParams?.token;
  const token = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  return <ResetCompleteClient token={token} />;
}
