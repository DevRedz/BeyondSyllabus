import { getSupabase } from "../../lib/supabase";
import { createClient } from "../../lib/supabase/server";

type CourseDetails = {
  course_code: string;
  title: string;
};

type CourseRelation = CourseDetails | CourseDetails[];

type UserCourseRow = {
  course_id: string;
  status: string;
  created_at: string;
  courses: CourseRelation;
};

type SavedItemRow = {
  id: string;
  course_id: string;
  item_type: string;
  generated_text: string | null;
  category: string | null;
  target_role: string;
  created_at: string;
  courses: CourseRelation;
};

function getCourse(course: CourseRelation) {
  return Array.isArray(course) ? course[0] : course;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

export default async function DashboardPage() {
  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError && authError.name !== "AuthSessionMissingError") {
    throw new Error(`Unable to verify the current user: ${authError.message}`);
  }

  if (!user) {
    return (
      <section className="dashboard-page">
        <div className="dashboard-heading">
          <p className="eyebrow">Your workspace</p>
          <h1>Dashboard</h1>
          <p>Sign in to see your courses, saved skills, and resume bullets.</p>
        </div>
      </section>
    );
  }

  const admin = getSupabase();
  const [courseResult, itemResult] = await Promise.all([
    admin
      .from("user_courses")
      .select("course_id, status, created_at, courses!inner(course_code, title)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    admin
      .from("ai_generations")
      .select("id, course_id, item_type, generated_text, category, target_role, created_at, courses!inner(course_code, title)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const loadError = courseResult.error?.message ?? itemResult.error?.message ?? "";
  const courseRows = (courseResult.data ?? []) as UserCourseRow[];
  const savedItems = (itemResult.data ?? []) as SavedItemRow[];
  const uniqueCourses = Array.from(
    new Map(courseRows.map((row) => [row.course_id, row])).values(),
  );
  const savedSkills = savedItems.filter((item) => item.item_type === "skill");
  const savedBullets = savedItems.filter(
    (item) => item.item_type === "resume_bullet",
  );
  const metadata = user.user_metadata as Record<string, unknown>;
  const displayName =
    [metadata.full_name, metadata.name, metadata.display_name].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ) ?? user.email?.split("@")[0] ?? "User";

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>Dashboard</h1>
          <p>Courses, skills, and resume bullets you have saved.</p>
        </div>
        <div className="dashboard-counts" aria-label="Dashboard totals">
          <span><strong>{uniqueCourses.length}</strong> courses</span>
          <span><strong>{savedSkills.length}</strong> skills</span>
          <span><strong>{savedBullets.length}</strong> bullets</span>
        </div>
      </div>

      {loadError ? (
        <div className="message error" role="alert">
          Could not load all dashboard data: {loadError}
        </div>
      ) : null}

      <section className="dashboard-profile" aria-labelledby="profile-heading">
        <div>
          <p className="eyebrow">Profile</p>
          <h2 id="profile-heading">{displayName}</h2>
        </div>
        <dl>
          <div>
            <dt>Email</dt>
            <dd>{user.email ?? "Not provided"}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{formatDate(user.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-section" aria-labelledby="courses-heading">
        <div className="dashboard-section-heading">
          <h2 id="courses-heading">My courses</h2>
          <span>{uniqueCourses.length}</span>
        </div>
        {uniqueCourses.length ? (
          <ul className="dashboard-course-list">
            {uniqueCourses.map((row) => {
              const course = getCourse(row.courses);
              return (
                <li key={row.course_id}>
                  <div>
                    <strong>{course.course_code}</strong>
                    <span>{course.title}</span>
                  </div>
                  <span className="dashboard-status">{formatStatus(row.status)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="dashboard-empty">
            No courses are linked to your profile yet.
          </p>
        )}
      </section>

      <div className="dashboard-saved-grid">
        <section className="dashboard-section" aria-labelledby="saved-skills-heading">
          <div className="dashboard-section-heading">
            <h2 id="saved-skills-heading">Saved skills</h2>
            <span>{savedSkills.length}</span>
          </div>
          {savedSkills.length ? (
            <ul className="dashboard-item-list">
              {savedSkills.map((item) => {
                const course = getCourse(item.courses);
                return (
                  <li key={item.id}>
                    <strong>{item.generated_text}</strong>
                    <span className="dashboard-item-meta">
                      {course.course_code} · {course.title}
                      {item.category ? ` · ${formatStatus(item.category)}` : ""}
                    </span>
                    <span className="dashboard-item-meta">Role: {item.target_role}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="dashboard-empty">No saved skills yet.</p>
          )}
        </section>

        <section className="dashboard-section" aria-labelledby="saved-bullets-heading">
          <div className="dashboard-section-heading">
            <h2 id="saved-bullets-heading">Saved resume bullets</h2>
            <span>{savedBullets.length}</span>
          </div>
          {savedBullets.length ? (
            <ul className="dashboard-item-list">
              {savedBullets.map((item) => {
                const course = getCourse(item.courses);
                return (
                  <li key={item.id}>
                    <strong>{item.generated_text}</strong>
                    <span className="dashboard-item-meta">
                      {course.course_code} · {course.title}
                    </span>
                    <span className="dashboard-item-meta">Role: {item.target_role}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="dashboard-empty">No saved resume bullets yet.</p>
          )}
        </section>
      </div>
    </section>
  );
}