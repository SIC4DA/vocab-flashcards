import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { signupsAllowed } from "@/lib/env";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return <AuthForm mode="login" next={typeof next === "string" ? next : undefined} signups={signupsAllowed()} />;
}
