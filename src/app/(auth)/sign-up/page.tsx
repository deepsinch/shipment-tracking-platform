import type { Metadata } from "next";

import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Create your Waybill account</h1>
      <SignUpForm />
    </main>
  );
}
