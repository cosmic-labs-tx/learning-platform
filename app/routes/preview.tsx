import { Link, MetaFunction, useLoaderData, useSearchParams } from "@remix-run/react";
import { ActionFunctionArgs, json, LoaderFunctionArgs, redirect } from "@vercel/remix";
import { useEffect, useState } from "react";

import { StrapiImage } from "~/components/common/strapi-image";
import { CourseHeader } from "~/components/course/course-header";
import { CoursePurchaseCTA } from "~/components/course/course-purchase-cta";
import { CourseUpNext, LessonInOrder } from "~/components/course/course-up-next";
import { ErrorComponent } from "~/components/error-component";
import { IconClipboard, IconDocument } from "~/components/icons";
import { PurchaseCanceledModal } from "~/components/purchase-canceled-modal";
import { PurchaseSuccessModal } from "~/components/purchase-success-modal";
import { Section, SectionHeader } from "~/components/section";
import { CoursePreviewLink } from "~/components/sidebar/course-preview-link";
import { CourseProgressBar } from "~/components/sidebar/course-progress-bar";
import { PreviewSectionLesson } from "~/components/sidebar/preview-section-lesson";
import { PreviewSectionQuiz } from "~/components/sidebar/preview-section-quiz";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { getCourse } from "~/integrations/cms.server";
import { db } from "~/integrations/db.server";
import { stripe } from "~/integrations/stripe.server";
import { Toasts } from "~/lib/toast.server";
import { SessionService } from "~/services/session.server";
import { APIResponseData } from "~/types/utils";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await SessionService.requireUser(request);

  const url = new URL(request.url);
  const linkedCourse = await db.course.findUnique({ where: { host: url.host } });
  if (!linkedCourse) {
    return Toasts.redirectWithError("/", {
      title: "Course not found.",
      description: "Please try again later",
    });
  }

  const [course, progress, quizProgress] = await Promise.all([
    getCourse(linkedCourse.strapiId),
    db.userLessonProgress.findMany({ where: { userId: user.id } }),
    db.userQuizProgress.findMany({ where: { userId: user.id } }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const userHasAccess = user.courses && user.courses.some((c) => c.courseId === linkedCourse.id);

  const lessonsInOrder = course.data.attributes.sections.flatMap((section) => {
    return (
      section.lessons?.data.map((l) => {
        const lessonProgress = progress.find((p) => p.lessonId === l.id);
        return {
          uuid: l.attributes.uuid,
          slug: l.attributes.slug,
          title: l.attributes.title,
          sectionId: section.id,
          sectionTitle: section.title,
          isCompleted: lessonProgress?.isCompleted ?? false,
          isTimed: l.attributes.required_duration_in_seconds && l.attributes.required_duration_in_seconds > 0,
          hasVideo: l.attributes.has_video,
          requiredDurationInSeconds: l.attributes.required_duration_in_seconds,
          progressDuration: lessonProgress?.durationInSeconds,
        };
      }) ?? []
    );
  });

  return json({ course: course.data, progress, lessonsInOrder, quizProgress, userHasAccess });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await SessionService.requireUser(request);
  const url = new URL(request.url);
  const course = await db.course.findUniqueOrThrow({
    where: { host: url.host },
  });

  const success_url = new URL("/purchase?success=true&session_id={CHECKOUT_SESSION_ID}", request.url).toString();
  const cancel_url = new URL("/purchase?success=false", request.url).toString();
  const session = await stripe.checkout.sessions.create({
    customer: user.stripeId ?? undefined,
    mode: "payment",
    line_items: [{ price: course.stripePriceId, quantity: 1 }],
    success_url,
    cancel_url,
    metadata: {
      user_id: user.id,
    },
  });

  return redirect(session.url ?? "/", { status: 303 });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [{ title: `Preview | ${data?.course.attributes.title}` }];
};

export default function CoursePreview() {
  const [searchParams] = useSearchParams();
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [canceledModalOpen, setCanceledModalOpen] = useState(false);
  const { course, progress, lessonsInOrder, quizProgress, userHasAccess } = useLoaderData<typeof loader>();

  const isSuccessful = searchParams.get("purchase_success") === "true";
  const isCanceled = searchParams.get("purchase_canceled") === "true";

  // handle success or cancel
  useEffect(() => {
    if (isSuccessful) {
      setSuccessModalOpen(true);
    } else if (isCanceled) {
      setCanceledModalOpen(true);
    }
  }, [isSuccessful, isCanceled]);

  const isCourseCompleted =
    lessonsInOrder.every((l) => l.isCompleted) &&
    course.attributes.sections.every(
      (s) => !s.quiz?.data || quizProgress.some((p) => p.quizId === s.quiz?.data.id && p.isCompleted),
    );

  // Find the index of the next lesson to be completed, or use the first lesson if all are completed
  const nextLessonIndex = lessonsInOrder.findIndex((l) => !l.isCompleted);
  const lastCompletedLessonIndex = Math.max(0, nextLessonIndex - 1);

  // Determine if the next content is a quiz and if it's incomplete
  const lastCompletedLessonSection = course.attributes.sections.find(
    (s) =>
      s.lessons?.data.some((l) => l.attributes.uuid === lessonsInOrder[lastCompletedLessonIndex]?.uuid) &&
      s.lessons.data.every((l) => lessonsInOrder.find((li) => li.uuid === l.attributes.uuid)?.isCompleted),
  );
  const nextQuiz =
    lastCompletedLessonSection?.quiz?.data &&
    !quizProgress.some((p) => p.quizId === lastCompletedLessonSection.quiz?.data.id && p.isCompleted)
      ? lastCompletedLessonSection.quiz.data
      : null;

  // Calculate total progress and duration in seconds
  const totalProgressInSeconds = progress.reduce((acc, curr) => acc + (curr.durationInSeconds ?? 0), 0);
  const totalDurationInSeconds = lessonsInOrder.reduce((acc, curr) => acc + (curr.requiredDurationInSeconds ?? 0), 0);

  // Timed Courses
  return (
    <>
      <div className="flex flex-col gap-x-12 px-4 py-4 lg:flex-row lg:py-4">
        <nav className="left-0 top-[88px] h-full shrink-0 basis-[448px] py-4 sm:py-10 lg:sticky lg:py-14">
          <StrapiImage
            asset={course.attributes.cover_image}
            height={240}
            width={448}
            fetchpriority="high"
            loading="eager"
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            alt={course.attributes.cover_image?.data?.attributes.alternativeText}
            className="w-full overflow-hidden rounded-xl object-cover shadow-[0px_8px_32px_0px_#00000029]"
          />
          <div className="mt-7">
            <CoursePreviewLink to={`.`}>
              <IconClipboard className="text-current" />
              <span>Course Chapters</span>
            </CoursePreviewLink>

            <CoursePreviewLink to={`/certificate`}>
              <IconDocument className="text-current" />
              <span>Certificate</span>
            </CoursePreviewLink>
          </div>
        </nav>

        <main className="max-w-screen-md lg:py-14">
          <div className="space-y-8">
            <CourseHeader courseTitle={course.attributes.title} numLessons={lessonsInOrder.length || 0} />
            <CourseProgressBar progress={totalProgressInSeconds} duration={totalDurationInSeconds} />
            {!userHasAccess ? (
              <CoursePurchaseCTA />
            ) : isCourseCompleted ? (
              <div className="text-center">
                <p className="rounded-md border border-success bg-success/5 p-4 text-lg text-success">
                  You have completed this course.
                </p>
              </div>
            ) : nextQuiz ? (
              <CourseUpNext quiz={{ id: nextQuiz.id, numQuestions: nextQuiz.attributes.questions?.length ?? 1 }} />
            ) : (
              <CourseUpNext lesson={lessonsInOrder[nextLessonIndex] as LessonInOrder} />
            )}
          </div>

          <ul className="relative mt-10 space-y-7">
            {course.attributes.sections.map((section, section_index) => {
              if (!section.lessons?.data.length && !section.quiz?.data) {
                return null;
              }

              const durationInSeconds = section.lessons?.data.reduce(
                (acc, curr) => Math.ceil((curr.attributes.required_duration_in_seconds || 0) + acc),
                0,
              );

              // This breaks with just a single quiz on it's own in a section, but that should never happen
              const isQuizLocked =
                !userHasAccess || lessonsInOrder.filter((l) => l.sectionId === section.id).some((l) => !l.isCompleted);
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              const userQuizProgress = quizProgress.find((qp) => qp.quizId === section.quiz?.data?.id) ?? null;

              return (
                <li key={`section-${section.id}`}>
                  <Section>
                    <SectionHeader sectionTitle={section.title} durationInMinutes={(durationInSeconds || 0) / 60} />
                    <Separator className="my-4" />
                    <ul className="flex flex-col gap-6">
                      {section.lessons?.data.map((l) => {
                        const lessonIndex = lessonsInOrder.findIndex((li) => li.uuid === l.attributes.uuid);
                        const lesson = lessonsInOrder[lessonIndex];

                        // Lock the lesson if the previous section's quiz is not completed
                        const previousSection =
                          section_index > 0 ? course.attributes.sections[section_index - 1] : null;
                        const previousSectionQuiz = previousSection?.quiz;
                        const previousSectionQuizIsCompleted = quizProgress.find(
                          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                          (p) => p.isCompleted && p.quizId === previousSectionQuiz?.data?.id,
                        );

                        const previousLessonIsCompleted = lessonsInOrder[lessonIndex - 1]?.isCompleted;
                        const isLessonLocked =
                          (lessonIndex > 0 && !lesson.isCompleted) ||
                          !userHasAccess ||
                          (previousSectionQuiz?.data && !previousSectionQuizIsCompleted) ||
                          (!isCourseCompleted &&
                            !previousLessonIsCompleted &&
                            lessonIndex > lastCompletedLessonIndex + 1);

                        const userLessonProgress = progress.find((lp) => lp.lessonId === l.id) ?? null;
                        return (
                          <div key={l.attributes.uuid} className="flex flex-wrap items-center justify-between gap-2">
                            <div className="shrink-0 grow">
                              <PreviewSectionLesson
                                lesson={l as APIResponseData<"api::lesson.lesson">}
                                userProgress={userLessonProgress}
                                locked={isLessonLocked}
                              />
                            </div>
                            {!isLessonLocked ? (
                              <Button asChild className="ml-12 grow-0 sm:ml-0 sm:w-auto" variant="secondary">
                                <Link to={`/${l.attributes.slug}`}>
                                  {!userLessonProgress
                                    ? "Start"
                                    : userLessonProgress.isCompleted
                                      ? "Revisit"
                                      : "Continue"}
                                </Link>
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                      {section.quiz?.data ? (
                        <div
                          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                          key={`quiz-${section.quiz.data?.id}`}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <PreviewSectionQuiz
                            quiz={section.quiz.data as APIResponseData<"api::quiz.quiz">}
                            userProgress={userQuizProgress}
                            locked={isQuizLocked}
                          />
                          {!isQuizLocked ? (
                            <Button asChild className="ml-12 grow-0 sm:ml-0 sm:w-auto" variant="secondary">
                              {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
                              <Link to={`/quizzes/${section.quiz.data?.id}`}>
                                {!userQuizProgress ? "Start" : userQuizProgress.isCompleted ? "View results" : "Start"}
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </ul>
                  </Section>
                </li>
              );
            })}
          </ul>
        </main>
      </div>
      <PurchaseSuccessModal open={successModalOpen} onOpenChange={setSuccessModalOpen} />
      <PurchaseCanceledModal open={canceledModalOpen} onOpenChange={setCanceledModalOpen} />
    </>
  );
}

export function ErrorBoundary() {
  return <ErrorComponent />;
}
