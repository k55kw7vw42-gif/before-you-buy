import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { isGoogleConfigured } from "@/lib/oauth/google";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in - Before You Pay" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/history");
  return (
    <Suspense>
      <AuthForm mode="login" googleEnabled={isGoogleConfigured()} />
    </Suspense>
  );
}
