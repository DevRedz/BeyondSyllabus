import type { Metadata } from "next";
import CourseCuration from "../../components/course-curation";
import { getSupabase } from "../../lib/supabase";
import { isRecoverableAuthSessionError } from "../../lib/supabase/auth-errors";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Syllabus Review | Beyond Syllabus",
  description: "Curate evidence-backed course skills and resume bullets.",
};

type Course = {
  id: string;
  course_code: string;
  title: string;
};

type SearchParamValue = string | string[] | undefined;

type SearchParams = {
  auth_error?: SearchParamValue;
  courseId?: SearchParamValue;
  historyId?: SearchParamValue;
};

type InitialOffering = {
  id: string | null;
  year: number;
  semester: string;
  section: string;
  professors: string[];
};

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function firstParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function getProfessorNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(getProfessorNames);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") return [record.name];
  return Object.values(record).flatMap(getProfessorNames);
}

export default async function SyllabusReview({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  let courses: Course[] = [];
  let errorMessage = "";
  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError && !isRecoverableAuthSessionError(authError)) {
    throw new Error(`Unable to verify the current user: ${authError.message}`);
  }
  const currentUser = authError ? null : user;

  try {
    const { data, error } = await getSupabase()
      .from("courses")
      .select("id, course_code, title")
      .order("course_code")
      .limit(5000);

    if (error) {
      errorMessage = error.message;
    } else {
      courses = (data ?? []) as Course[];
    }
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Unable to load the table.";
  }

  let initialCourse: Course | null = null;
  let initialOffering: InitialOffering | null = null;
  let initialCourseCompleted = false;
  const requestedCourseId = firstParam(searchParams?.courseId);
  const requestedHistoryId = firstParam(searchParams?.historyId);

  const requestedCourse = isUuid(requestedCourseId)
    ? courses.find((course) => course.id === requestedCourseId)
    : undefined;

  if (currentUser && requestedCourse) {
    const admin = getSupabase();
    const { data: enrollment } = await admin
      .from("user_courses")
      .select("status")
      .eq("user_id", currentUser.id)
      .eq("course_id", requestedCourse.id)
      .maybeSingle();

    if (enrollment) {
      initialCourse = requestedCourse;
      initialCourseCompleted = enrollment.status === "completed";

      const historyBaseQuery = admin
        .from("user_course_history")
        .select("id, term_year, term_semester, section, offering_id, course_offerings(offering_professors(professors(name)))")
        .eq("user_id", currentUser.id)
        .eq("course_id", requestedCourse.id);

      const { data: history } = requestedHistoryId && isUuid(requestedHistoryId)
        ? await historyBaseQuery.eq("id", requestedHistoryId).maybeSingle()
        : { data: null };
      if (history) {
        initialOffering = {
          id: history.offering_id,
          year: history.term_year,
          semester: history.term_semester,
          section: history.section,
          professors: getProfessorNames(history.course_offerings),
        };
      }
    }
  }

  return (
    <section className="course-curation-page">
      {searchParams?.auth_error ? (
        <div className="message error" role="alert">
          Google sign-in could not be completed. Please try again.
        </div>
      ) : null}
      {errorMessage ? (
        <div className="message error" role="alert">
          {errorMessage}
        </div>
      ) : (
        <CourseCuration
          courses={courses}
          isSignedIn={Boolean(currentUser)}
          initialCourse={initialCourse}
          initialOffering={initialOffering}
          initialCourseCompleted={initialCourseCompleted}
        />
      )}
    </section>
  );
}
