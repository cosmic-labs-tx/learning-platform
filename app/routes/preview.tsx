import { Prisma } from "@prisma/client";
import { LoaderFunctionArgs } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";

import { StrapiImage } from "~/components/common/strapi-image";
import { CourseHeader } from "~/components/course/course-header";
import { CoursePurchaseCTA } from "~/components/course/course-purchase-cta";
import { CourseUpNext } from "~/components/course/course-up-next";
import { ErrorComponent } from "~/components/error-component";
import { Header } from "~/components/header";
import { IconCertificate, IconClipboard, IconDocument } from "~/components/icons";
import {
  Section,
  SectionHeader,
  SectionItemContainer,
  SectionItemIconContainer,
  SectionItemTitle,
} from "~/components/section";
import { CoursePreviewLink } from "~/components/sidebar/course-preview-link";
import { CourseProgressBar } from "~/components/sidebar/course-progress-bar";
import { SectionLesson } from "~/components/sidebar/section-lesson";
import { SectionQuiz } from "~/components/sidebar/section-quiz";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { getCourse } from "~/integrations/cms.server";
import { db } from "~/integrations/db.server";
import { Sentry } from "~/integrations/sentry";
import { handlePrismaError, serverError } from "~/lib/responses.server";
import { SessionService } from "~/services/SessionService.server";
import { TypedMetaFunction } from "~/types/utils";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await SessionService.requireUser(request);

  try {
    const { host } = new URL(request.url);
    const linkedCourse = await db.course.findUniqueOrThrow({ where: { host } });
    const course = await getCourse(linkedCourse.strapiId);
    const progress = await db.userLessonProgress.findMany({ where: { userId: user.id } });
    const quizProgress = await db.userQuizProgress.findMany({ where: { userId: user.id } });

    const userHasAccess = user.courses.some((c) => c.courseId === linkedCourse.id);

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

    return typedjson({ course: course.data, progress, lessonsInOrder, quizProgress, userHasAccess });
  } catch (error) {
    console.error(error);
    Sentry.captureException(error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      handlePrismaError(error);
    }
    throw serverError("An error occurred while loading the course. Please try again.");
  }
}

export const meta: TypedMetaFunction<typeof loader> = ({ data }) => {
  return [{ title: `Preview | ${data?.course.attributes.title}` }];
};

export default function CourseIndex() {
  const { course, progress, lessonsInOrder, quizProgress, userHasAccess } = useTypedLoaderData<typeof loader>();

  // Calculate the lesson last completed lesson, defaulting to the first lesson
  const nextLessonIndex = lessonsInOrder.findIndex((l) => !l.isCompleted);
  const lastCompletedLessonIndex = nextLessonIndex === -1 ? 0 : nextLessonIndex - 1;
  const nextLesson = lessonsInOrder.at(nextLessonIndex);

  // Check if a quiz is next
  const lasCompletedLessonSection = course.attributes.sections.find(
    (s) =>
      s.lessons?.data.some((l) => l.attributes.uuid === lessonsInOrder[lastCompletedLessonIndex]?.uuid) &&
      s.lessons.data.every((l) => lessonsInOrder.find((li) => li.uuid === l.attributes.uuid)?.isCompleted),
  );
  const lastCompletedLessonSectionHasIncompleteQuiz =
    lasCompletedLessonSection?.quiz?.data &&
    !quizProgress.find((p) => p.quizId === lasCompletedLessonSection.quiz?.data.id)?.isCompleted;
  const nextQuiz = lastCompletedLessonSectionHasIncompleteQuiz ? lasCompletedLessonSection.quiz?.data : null;

  // Sum the user progress to get the total progress
  const totalProgressInSeconds = progress.reduce((acc, curr) => {
    return acc + (curr.durationInSeconds ?? 0);
  }, 0);

  const totalDurationInSeconds = lessonsInOrder.reduce((acc, curr) => {
    return acc + (curr.requiredDurationInSeconds ?? 0);
  }, 0);

  // Course is complete if:
  const isCourseComplete =
    // All lessons are completed
    lessonsInOrder.every((l) => l.isCompleted) &&
    // All quizzes are completed
    course.attributes.sections.every((s) => {
      return !s.quiz?.data || quizProgress.find((p) => p.quizId === s.quiz?.data.id)?.isCompleted;
    });

  // Timed Courses
  return (
    <>
      <Header />
      <div className="flex flex-col gap-x-12 px-4 py-4 lg:flex-row lg:py-4">
        <nav className="left-0 top-[88px] h-full shrink-0 basis-[448px] py-10 md:py-14 lg:sticky">
          <StrapiImage
            asset={course.attributes.cover_image}
            height={240}
            width={448}
            fetchPriority="high"
            loading="eager"
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            alt={course.attributes.cover_image?.data?.attributes.alternativeText}
            className="overflow-hidden rounded-xl object-cover shadow-[0px_8px_32px_0px_#00000029]"
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
            ) : isCourseComplete ? (
              <div className="text-center">
                <p className="text-lg">Congratulations! You have completed this course.</p>
              </div>
            ) : nextQuiz ? (
              <CourseUpNext quiz={{ id: nextQuiz.id, numQuestions: nextQuiz.attributes.questions?.length ?? 1 }} />
            ) : nextLesson ? (
              <CourseUpNext lesson={lessonsInOrder[lastCompletedLessonIndex + 1]} />
            ) : null}
          </div>

          <ul className="relative mt-10 space-y-7">
            {course.attributes.sections.map((section, section_index) => {
              const durationInSeconds = section.lessons?.data.reduce(
                (acc, curr) => Math.ceil((curr.attributes.required_duration_in_seconds || 0) + acc),
                0,
              );
              const isQuizLocked = lessonsInOrder.filter((l) => l.sectionId === section.id).some((l) => !l.isCompleted);

              return (
                <li key={`section-${section.id}`}>
                  <Section>
                    <SectionHeader sectionTitle={section.title} durationInMinutes={(durationInSeconds || 1) / 60} />
                    <Separator className="my-4" />
                    <ul className="flex flex-col gap-4">
                      {section.lessons?.data.map((l) => {
                        const lessonIndex = lessonsInOrder.findIndex((li) => li.uuid === l.attributes.uuid);

                        // Lock the lesson if the previous section's quiz is not completed
                        const previousSection =
                          section_index > 0 ? course.attributes.sections[section_index - 1] : null;
                        const previousSectionQuiz = previousSection?.quiz;
                        const previousSectionQuizIsCompleted = quizProgress.find(
                          (p) => p.isCompleted && p.quizId === previousSectionQuiz?.data.id,
                        );
                        const isLessonLocked =
                          !userHasAccess ||
                          (previousSectionQuiz && !previousSectionQuizIsCompleted) ||
                          lessonIndex > lastCompletedLessonIndex + 1;

                        return (
                          <SectionLesson
                            key={l.attributes.uuid}
                            lesson={l}
                            userProgress={progress.find((lp) => lp.lessonId === l.id) ?? null}
                            locked={isLessonLocked}
                          />
                        );
                      })}
                      {section.quiz?.data ? (
                        <SectionQuiz
                          quiz={section.quiz.data}
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
              <Section>
                <SectionHeader sectionTitle="Certificate" />
                <Separator className="my-4" />
                <div
                  className="-my-1 block rounded-lg py-1"
                  aria-label="This lesson is locked until previous lessons are completed."
                >
                  <SectionItemContainer>
                    <SectionItemIconContainer>
                      <IconCertificate className="h-7 w-6 text-gray-400 contrast-more:text-gray-500 dark:text-gray-600 contrast-more:dark:text-gray-400" />
                    </SectionItemIconContainer>
                    <div className="flex flex-col justify-center">
                      <SectionItemTitle className="text-gray-400 contrast-more:text-gray-500 dark:text-gray-600 contrast-more:dark:text-gray-400">
                        Certificate
                      </SectionItemTitle>
                    </div>
                    <Button variant="secondary" className="ml-auto w-auto" asChild>
                      <Link to="/certificate">Claim</Link>
                    </Button>
                  </SectionItemContainer>
                </div>
              </Section>
            </li>
          </ul>
        </main>
      </div>
    </>
  );
}

export function ErrorBoundary() {
  return <ErrorComponent />;
}
