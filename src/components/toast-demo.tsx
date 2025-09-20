"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { login } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const toast = useToast();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await login(email, password);
      toast({ title: "Signed in", description: "Welcome back 👋" });
      router.push("/");
    } catch (err: any) {
      const detail = err?.response?.data?.detail || "An unexpected error occurred";
      toast({ title: "Login failed", description: detail });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-[350px]">
        <form onSubmit={onSubmit}>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full">
              Sign In
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}