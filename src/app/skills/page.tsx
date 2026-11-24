import CourseSkills from "../../components/course-skills";
import { isRecoverableAuthSessionError } from "../../lib/supabase/auth-errors";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CourseSkillsPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !isRecoverableAuthSessionError(error)) {
    throw new Error(`Unable to verify the current user: ${error.message}`);
  }

  return <CourseSkills isSignedIn={Boolean(user && !error)} />;
}
