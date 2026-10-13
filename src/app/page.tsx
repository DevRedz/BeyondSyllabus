import CourseCuration from "../components/course-curation";
import { getSupabase } from "../lib/supabase";
import { createClient } from "../lib/supabase/server";

export const dynamic = "force-dynamic";

type Course = {
  id: string;
  course_code: string;
  title: string;
};

export default async function Home({
  searchParams,
}: {
  searchParams?: { auth_error?: string };
}) {
  let courses: Course[] = [];
  let errorMessage = "";
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();

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
        <CourseCuration courses={courses} isSignedIn={Boolean(user)} />
      )}
    </section>
  );
}