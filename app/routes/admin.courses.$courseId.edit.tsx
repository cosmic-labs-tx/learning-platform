import { Prisma } from "@prisma/client";
import { MetaFunction, useRouteLoaderData } from "@remix-run/react";
import { withZod } from "@remix-validated-form/with-zod";
import { ActionFunctionArgs, LoaderFunctionArgs, json } from "@vercel/remix";
import { ValidatedForm, validationError } from "remix-validated-form";
import { z } from "zod";

import { ErrorComponent } from "~/components/error-component";
import { Checkbox, FormField } from "~/components/ui/form";
import { Label } from "~/components/ui/label";
import { SubmitButton } from "~/components/ui/submit-button";
import { db } from "~/integrations/db.server";
import { Sentry } from "~/integrations/sentry";
import { getPrismaErrorText } from "~/lib/responses.server";
import { CheckboxSchema } from "~/lib/schemas";
import { toast } from "~/lib/toast.server";
import { loader as adminCourseLoader } from "~/routes/admin.courses.$courseId";
import { SessionService } from "~/services/SessionService.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await SessionService.requireAdmin(request);
  return json({});
}

const validator = withZod(
  z.object({
    host: z.string({ message: "Host is required" }),
    strapiId: z.coerce.number({ message: "Strapi ID is required" }),
    stripePriceId: z.string({ message: "Stripe price ID is required" }),
    stripeProductId: z.string({ message: "Stripe product ID is required" }),
    requiresIdentityVerification: CheckboxSchema,
  }),
);

export async function action({ request, params }: ActionFunctionArgs) {
  await SessionService.requireAdmin(request);
  const id = params.courseId;

  const result = await validator.validate(await request.formData());
  if (result.error) {
    return validationError(result.error);
  }

  try {
    const course = await db.course.update({
      where: { id },
      data: result.data,
    });
    return toast.json(
      request,
      { course },
      {
        title: "Course updated successfully.",
        type: "success",
      },
    );
  } catch (error) {
    console.error(error);
    Sentry.captureException(error);
    let message = error instanceof Error ? error.message : "An error occurred while updating the course.";
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      message = getPrismaErrorText(error);
    }
    return toast.json(
      request,
      { ok: false },
      {
        title: "Error.",
        description: message,
        type: "error",
      },
      { status: 500 },
    );
  }
}

export const meta: MetaFunction = () => [{ title: "Edit Course | Plumb Media & Education" }];

export default function AdminEditCourse() {
  const data = useRouteLoaderData<typeof adminCourseLoader>("routes/admin.courses.$courseId");

  if (!data?.course) {
    throw new Error("Course not found.");
  }

  return (
    <ValidatedForm
      id="course-form"
      method="PUT"
      validator={validator}
      defaultValues={{ ...data.course }}
      className="max-w-md space-y-4"
    >
      <FormField required label="Host" name="host" description="e.g. course.hiphopdriving.com" />
      <FormField required label="CMS ID" name="strapiId" description="ID of the course in the CMS" />
      <FormField required label="Stripe Price ID" name="stripePriceId" description="Refer to the Stripe dashboard" />
      <FormField
        required
        label="Stripe Product ID"
        name="stripeProductId"
        description="Refer to the Stripe dashboard"
      />
      <div className="flex items-center gap-x-2">
        <Checkbox
          id="requiresIdentityVerification"
          name="requiresIdentityVerification"
          aria-labelledby="identity-label"
          defaultChecked={data.course.requiresIdentityVerification}
        />
        <Label id="identity-label" htmlFor="requiresIdentityVerification" className="cursor-pointer">
          Require identity verification to complete
        </Label>
      </div>
      <SubmitButton variant="admin" className="mt-4">
        Save
      </SubmitButton>
    </ValidatedForm>
  );
}

export function ErrorBoundary() {
  return <ErrorComponent />;
}
