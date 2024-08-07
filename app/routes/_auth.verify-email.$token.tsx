import { Link } from "@remix-run/react";
import { json, LoaderFunctionArgs } from "@vercel/remix";

import { PageTitle } from "~/components/common/page-title";
import { db } from "~/integrations/db.server";
import { Sentry } from "~/integrations/sentry";
import { badRequest } from "~/lib/responses.server";
import { toast } from "~/lib/toast.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const paramToken = params.token;
  if (!paramToken) {
    throw badRequest("Token is required");
  }

  try {
    const token = await db.userVerification.findFirst({
      where: { token: paramToken },
      include: { user: true },
    });

    if (!token) {
      return toast.redirect(request, "/login", { type: "error", title: "Invalid token" });
    }

    if (token.expiresAt < new Date()) {
      return toast.redirect(request, "/login", { type: "error", title: "Token expired" });
    }

    await db.$transaction([
      db.userVerification.update({
        where: { id: token.id },
        data: { expiresAt: new Date() },
      }),
      db.user.update({
        where: { id: token.userId },
        data: { isEmailVerified: true },
      }),
    ]);

    return json({ success: true });
  } catch (error) {
    console.error(error);
    Sentry.captureException(error);
    throw error;
  }
}

export default function VerifyEmail() {
  return (
    <div className="space-y-2 text-center">
      <PageTitle>Email Verified</PageTitle>
      <p>Your email has been verified!</p>
      <Link to="/login">Login</Link>
    </div>
  );
}
