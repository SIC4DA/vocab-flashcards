import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { signupsAllowed } from "@/lib/env";

export const metadata: Metadata = { title: "Sign up" };

export default function RegisterPage() {
  return <AuthForm mode="register" signups={signupsAllowed()} />;
}
