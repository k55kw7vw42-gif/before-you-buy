import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign up - Before You Pay" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/history");
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
