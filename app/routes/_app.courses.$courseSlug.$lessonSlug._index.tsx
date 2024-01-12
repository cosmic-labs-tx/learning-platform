import { ActionFunctionArgs, LoaderFunctionArgs, json } from "@remix-run/node";
import { withZod } from "@remix-validated-form/with-zod";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { validationError } from "remix-validated-form";
import invariant from "tiny-invariant";
import { z } from "zod";

import { ProgressTimer } from "~/components/lesson/ProgressTimer";
import { db } from "~/integrations/db.server";
import { getEntry } from "~/integrations/strapi.server.";
import { badRequest, notFound } from "~/lib/responses.server";
import { SessionService } from "~/services/SessionService.server";

export const SUBMIT_INTERVAL_MS = 15_000;

export async function loader({ params, request }: LoaderFunctionArgs) {
  const userId = await SessionService.requireUserId(request);

  const courseSlug = params.courseSlug;
  const lessonSlug = params.lessonSlug;
  invariant(courseSlug, "Course slug is required");
  invariant(lessonSlug, "Lesson slug is required");

  const lesson = await db.lesson.findUnique({
    where: {
      slug: lessonSlug,
      course: { slug: courseSlug },
    },
  });
  if (!lesson) {
    throw notFound({ message: "Lesson not found" });
  }

  const content = await getEntry("lessons", lesson.strapiId);
  if (!content) {
    throw notFound({ message: "Lesson content not found" });
  }

  const progress = await db.userLessonProgress.findUnique({
    where: { userId, lessonId: lesson.id },
  });

  return typedjson({ lesson, content, progress });
}

const validator = withZod(
  z.object({
    userId: z.string().cuid(),
    lessonId: z.string().cuid(),
  }),
);

export async function action({ request }: ActionFunctionArgs) {
  const result = await validator.validate(await request.formData());
  if (result.error) {
    throw validationError(result.error);
  }

  const { lessonId, userId } = result.data;

  const progress = await db.userLessonProgress.findFirst({
    where: { lessonId, userId },
    include: { lesson: { select: { requiredDurationInSeconds: true } } },
  });

  if (progress) {
    if (progress.isCompleted) {
      throw badRequest({ message: "Can't update progress on a lesson that's already completed." });
    }

    // Prevent spamming the endpoint
    const now = new Date().getTime();
    const lastUpdate = progress.updatedAt.getTime();

    if (now - lastUpdate < SUBMIT_INTERVAL_MS) {
      throw json({ message: "Progress updates were too close together." }, { status: 429 });
    }

    // Mark lesson complete if we're about to hit the required duration;
    if (progress.lesson.requiredDurationInSeconds !== null && progress.durationInSeconds + SUBMIT_INTERVAL_MS / 1_000 >= progress.lesson.requiredDurationInSeconds) {
      const completedProgress = await db.userLessonProgress.update({
        where: { id: progress.id },
        data: { isCompleted: true, durationInSeconds: { increment: SUBMIT_INTERVAL_MS / 1_000 } },
      });
      return typedjson({ progress: completedProgress });
    }
  }

  // Create or update progress
  const currentProgress = await db.userLessonProgress.upsert({
    where: { lessonId, userId },
    create: {
      lessonId,
      userId,
      durationInSeconds: SUBMIT_INTERVAL_MS / 1_000,
    },
    update: { durationInSeconds: { increment: SUBMIT_INTERVAL_MS / 1_000 } },
    include: { lesson: { select: { requiredDurationInSeconds: true } } },
  });

  if (!currentProgress.lesson.requiredDurationInSeconds) {
    return typedjson({ progress: currentProgress });
  }

  // Lessons with required durations
  if (currentProgress.lesson.requiredDurationInSeconds && currentProgress.durationInSeconds >= currentProgress.lesson.requiredDurationInSeconds) {
    const progress = await db.userLessonProgress.update({
      where: { id: currentProgress.id },
      data: { isCompleted: true },
    });
    return typedjson({ progress });
  }

  return typedjson({ progress: currentProgress });
}

export default function Course() {
  const { lesson, content, progress } = useTypedLoaderData<typeof loader>();

  return (
    <div className="border border-purple-800 p-6">
      <h1>{content.data.attributes.title}</h1>
      <ProgressTimer lesson={lesson} progress={progress} />
      <pre className="text-sm">{JSON.stringify({ content, lesson, progress }, null, 2)}</pre>
    </div>
  );
}
