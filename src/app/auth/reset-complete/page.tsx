import ResetCompleteClient from "./Client";

export default function Page({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  const token =
    typeof searchParams?.token === "string" ? searchParams.token : "";

  return <ResetCompleteClient token={token} />;
}