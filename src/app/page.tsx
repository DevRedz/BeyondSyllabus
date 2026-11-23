import type { Metadata } from "next";
import ResumeBuilder, { type ResumeItem } from "../components/resume-builder";
import { getSupabase } from "../lib/supabase";
import { createClient } from "../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resume Builder | Beyond Syllabus",
  description: "Build a resume from your saved course skills and projects.",
};

type CourseRelation = {
  course_code: string;
  title: string;
} | Array<{
  course_code: string;
  title: string;
}>;

type SavedItemRow = {
  id: string;
  course_id: string;
  item_type: "skill" | "resume_bullet";
  generated_text: string | null;
  category: string | null;
  resume_section: "skills" | "projects" | null;
  resume_position: number | null;
  created_at: string;
  courses: CourseRelation;
};

function getCourse(course: CourseRelation) {
  return Array.isArray(course) ? course[0] : course;
}

function getDisplayName(user: { email?: string; user_metadata?: unknown }) {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  return (
    [metadata.full_name, metadata.name, metadata.display_name].find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    ) ??
    user.email?.split("@")[0] ??
    "Your name"
  );
}

export default async function ResumePage({
  searchParams,
}: {
  searchParams?: { auth_error?: string };
}) {
  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError && authError.name !== "AuthSessionMissingError") {
    throw new Error(`Unable to verify the current user: ${authError.message}`);
  }

  let items: ResumeItem[] = [];
  let loadError = "";
  if (user) {
    const { data, error } = await getSupabase()
      .from("ai_generations")
      .select("id, course_id, item_type, generated_text, category, resume_section, resume_position, created_at, courses!inner(course_code, title)")
      .eq("user_id", user.id)
      .in("item_type", ["skill", "resume_bullet"])
      .not("generated_text", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      loadError = `Could not load your saved items: ${error.message}`;
    } else {
      items = ((data ?? []) as SavedItemRow[]).flatMap((row) => {
        if (!row.generated_text?.trim()) return [];
        const course = getCourse(row.courses);
        if (!course) return [];
        return [{
          id: row.id,
          courseId: row.course_id,
          courseCode: course.course_code,
          courseTitle: course.title,
          itemType: row.item_type,
          text: row.generated_text,
          category: row.category,
          resumeSection: row.resume_section,
          resumePosition: row.resume_position,
          createdAt: row.created_at,
        }];
      });
    }
  }

  return (
    <ResumeBuilder
      items={items}
      isSignedIn={Boolean(user)}
      displayName={user ? getDisplayName(user) : "Your name"}
      email={user?.email ?? ""}
      authError={Boolean(searchParams?.auth_error)}
      loadError={loadError}
    />
  );
}
