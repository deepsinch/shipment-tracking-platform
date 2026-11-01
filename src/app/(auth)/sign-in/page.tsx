import type { Metadata } from "next";
import { Suspense } from "react";

import { DemoOnly } from "@/components/demo/demo-only";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { DemoSignIn } from "./demo-sign-in";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>Welcome back. Sign in to your dispatch dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
      <Suspense fallback={null}>
        <DemoOnly>
          <DemoSignIn />
        </DemoOnly>
      </Suspense>
    </>
  );
}
