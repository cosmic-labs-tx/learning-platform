/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { Outlet, useParams } from "@remix-run/react";
import { json, LoaderFunctionArgs } from "@vercel/remix";
import { useState } from "react";
import { useIsClient, useMediaQuery } from "usehooks-ts";

import { BackLink } from "~/components/common/back-link";
import { Section, SectionHeader } from "~/components/section";
import { SectionCertificate } from "~/components/section/section-certificate";
import { CourseProgressBar } from "~/components/sidebar/course-progress-bar";
import { SectionLesson } from "~/components/sidebar/section-lesson";
import { SectionQuiz } from "~/components/sidebar/section-quiz";
import { Separator } from "~/components/ui/separator";
import { useCourseData } from "~/hooks/useCourseData";
import { db } from "~/integrations/db.server";
import { Sentry } from "~/integrations/sentry";
import { Toasts } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import { getCoursefromCMSForCourseLayout, getLinkedCourseByHost } from "~/models/course.server";
import { SessionService } from "~/services/session.server";
import { APIResponseData } from "~/types/utils";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await SessionService.requireUser(request);

  try {
    const { host } = new URL(request.url);
    const linkedCourse = await getLinkedCourseByHost(host);

    if (!linkedCourse) {
      return Toasts.redirectWithError("/preview", {
        title: "Course not found",
        description: "Please try again later",
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const userHasAccess = user.courses && user.courses.some((c) => c.courseId === linkedCourse.id);
    if (!userHasAccess) {
      return Toasts.redirectWithError("/preview", {
        title: "No access to course",
        description: "Please purchase the course to access it.",
      });
    }

    const course = await getCoursefromCMSForCourseLayout(linkedCourse.strapiId);

    if (!course) {
      return Toasts.redirectWithError("/preview", {
        title: "Failed to load course",
        description: "Please try again later",
      });
    }

    const progress = await db.userLessonProgress.findMany({ where: { userId: user.id } });
    const quizProgress = await db.userQuizProgress.findMany({ where: { userId: user.id } });

    const lessonsInOrder = course.data.attributes.sections.flatMap((section) => {
      return (
        section.lessons?.data.map((l) => {
          const lessonProgress = progress.find((p) => p.lessonId === l.id);
          return {
            id: l.id,
            uuid: l.attributes.uuid,
            slug: l.attributes.slug.toLowerCase(),
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

    return json({ course: course.data, progress, lessonsInOrder, quizProgress });
  } catch (error) {
    console.error(error);
    Sentry.captureException(error);
    return Toasts.redirectWithError("/preview", {
      title: "Failed to load course",
      description: "Please try again later",
    });
  }
}

export default function CourseLayout() {
  const { course, lessonsInOrder, progress, quizProgress } = useCourseData();
  const params = useParams();
  const [isShowingMore, setIsShowingMore] = useState(false);
  const isClient = useIsClient();
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const isCollapsed = !isShowingMore && !isLargeScreen;

  function toggleShowMore() {
    setIsShowingMore((prev) => !prev);
  }

  const { sections } = course.attributes;

  const isCourseCompleted =
    lessonsInOrder.every((l) => l.isCompleted) &&
    course.attributes.sections.every(
      (s) => !s.quiz?.data || quizProgress.some((p) => p.quizId === s.quiz?.data.id && p.isCompleted),
    );

  // Simplify the calculation of the next and last completed lesson indices
  const nextLessonIndex = lessonsInOrder.findIndex((l) => !l.isCompleted);
  const lastCompletedLessonIndex = Math.max(0, nextLessonIndex - 1); // Ensures a minimum of 0
  const nextLesson = lessonsInOrder[nextLessonIndex] ?? lessonsInOrder[0];

  const isQuizActive = Boolean(params.quizId);
  const activeQuiz = sections.find((s) => s.quiz?.data?.id === Number(params.quizId))?.quiz ?? null;
  const activeQuizProgress = quizProgress.find((p) => p.quizId === activeQuiz?.data?.id);

  const activeLesson = lessonsInOrder.find((l) => l.slug === params.lessonSlug) ?? null;
  const activeLessonProgress = progress.find((p) => p.lessonId === activeLesson?.id);
  const activeSection = activeQuiz
    ? sections.find((s) => s.quiz?.data?.attributes.uuid === activeQuiz.data?.attributes.uuid)
    : sections.find((s) => s.id === activeLesson?.sectionId) ?? sections[0];

  // Use direct summation for progress and duration, removing unnecessary return statements
  const totalProgressInSeconds = progress.reduce((acc, curr) => acc + (curr.durationInSeconds ?? 0), 0);
  const totalDurationInSeconds = lessonsInOrder.reduce((acc, curr) => acc + (curr.requiredDurationInSeconds ?? 0), 0);
  if (!isClient) {
    return null;
  }

  return (
    <>
      <div className="max-w-screen-xl">
        <nav className="overflow-visible px-4 py-4 lg:fixed lg:bottom-0 lg:left-0 lg:top-20 lg:w-[448px] lg:overflow-auto lg:py-12">
          <BackLink to="/preview">Back to course</BackLink>
          {/* TODO: Adjust for non timed courses */}
          <div className="my-7">
            <CourseProgressBar progress={totalProgressInSeconds} duration={totalDurationInSeconds} />
          </div>

          <ul className="relative space-y-7">
            {sections
              .filter((s) => {
                if (isCollapsed) {
                  if (activeLessonProgress?.isCompleted || activeQuizProgress?.isCompleted) {
                    return s.id === activeSection?.id || s.id === nextLesson?.sectionId;
                  }
                  return s.id === activeSection?.id;
                }
                return true;
              })
              .map((section, section_index) => {
                const durationInSeconds = section.lessons?.data.reduce(
                  (acc, curr) => Math.ceil((curr.attributes.required_duration_in_seconds || 0) + acc),
                  0,
                );

                const isQuizLocked = lessonsInOrder
                  .filter((l) => l.sectionId === section.id)
                  .some((l) => !l.isCompleted);
                const shouldShowQuizInSection = isCollapsed ? isQuizActive || !isQuizLocked : true;

                return (
                  <li key={`section-${section.id}`} data-sectionid={section.id}>
                    <Section className={cn(isCollapsed && "pb-16")}>
                      <SectionHeader sectionTitle={section.title} durationInMinutes={(durationInSeconds || 0) / 60} />
                      <Separator className={cn(isCollapsed ? "my-2 bg-transparent" : "my-4")} />
                      <ul className="flex flex-col gap-6">
                        {section.lessons?.data
                          .filter((l) => {
                            if (isCollapsed) {
                              // If lesson is completed, show the next lesson too
                              if (activeLessonProgress?.isCompleted || activeQuizProgress?.isCompleted) {
                                return (
                                  l.attributes.uuid === activeLesson?.uuid ||
                                  (nextLesson && l.attributes.uuid === nextLesson.uuid)
                                );
                              }
                              // Or just show active lesson when collapsed
                              return l.attributes.uuid === activeLesson?.uuid;
                            }
                            return true;
                          })
                          .map((l) => {
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

                            const lastLessonIsCompleted = lessonsInOrder[lastCompletedLessonIndex]?.isCompleted;
                            const isLessonLocked =
                              (lessonIndex > 0 && !lesson.isCompleted) ||
                              (previousSectionQuiz?.data && !previousSectionQuizIsCompleted) ||
                              (!isCourseCompleted &&
                                !lastLessonIsCompleted &&
                                lessonIndex > lastCompletedLessonIndex + 1);

                            return (
                              <SectionLesson
                                key={l.attributes.uuid}
                                lesson={l as APIResponseData<"api::lesson.lesson">}
                                userProgress={progress.find((lp) => lp.lessonId === l.id) ?? null}
                                locked={isLessonLocked}
                              />
                            );
                          })}
                        {section.quiz?.data && shouldShowQuizInSection ? (
                          <SectionQuiz
                            quiz={section.quiz.data as APIResponseData<"api::quiz.quiz">}
                            userProgress={quizProgress.find((qp) => qp.quizId === section.quiz?.data.id) ?? null}
                            locked={isQuizLocked}
                          />
                        ) : null}
                      </ul>
                    </Section>
                  </li>
                );
              })}
            <li key="section-certificate">
              <SectionCertificate isCourseCompleted={isCourseCompleted} />
            </li>
            {!isLargeScreen ? (
              <button
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 self-center rounded text-center text-base font-light ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  !isCollapsed ? "-bottom-12" : "bottom-6",
                )}
                onClick={toggleShowMore}
              >
                {!isCollapsed ? "Show less" : "Show more"}
              </button>
            ) : null}
          </ul>
        </nav>
        <main className="px-4 py-12 lg:ml-[480px] lg:max-w-screen-lg lg:pl-0 lg:pr-4">
          <Outlet />
        </main>
      </div>
    </>
  );
}
