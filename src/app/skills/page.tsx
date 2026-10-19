import CourseSkills from "../../components/course-skills";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CourseSkillsPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && error.name !== "AuthSessionMissingError") {
    throw new Error(`Unable to verify the current user: ${error.message}`);
  }

  return <CourseSkills isSignedIn={Boolean(user)} />;
}
