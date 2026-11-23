import { getSupabase } from "../../lib/supabase";
import { createClient } from "../../lib/supabase/server";
import type { Metadata } from "next";
import Link from "next/link";
import CourseHistoryImport from "../../components/course-history-import";
import ProfileDeleteButton from "../../components/profile-delete-button";

export const metadata: Metadata = {
  title: "Your Profile | Beyond Syllabus",
  description: "Your courses, saved skills, and resume bullets.",
};

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
  is_public: boolean;
  created_at: string;
  courses: CourseRelation;
};

type CourseHistoryRow = {
  id: string;
  course_id: string;
  term_year: number;
  term_semester: string;
  section: string;
  offering_id: string | null;
  course_offerings: unknown;
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

function semesterOrder(value: string) {
  return { Spring: 0, Summer: 1, Fall: 2, Winter: 3 }[value] ?? -1;
}

function getProfessorNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(getProfessorNames);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") return [record.name];
  return Object.values(record).flatMap(getProfessorNames);
}

function getDraftHref(courseId: string, historyId?: string) {
  const params = new URLSearchParams({ courseId });
  if (historyId) params.set("historyId", historyId);
  return `/review?${params.toString()}`;
}

export default async function ProfilePage() {
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
          <h1>Your profile</h1>
          <p>Sign in to see your courses, saved skills, and resume bullets.</p>
        </div>
      </section>
    );
  }

  const admin = getSupabase();
  const [courseResult, itemResult, historyResult] = await Promise.all([
    admin
      .from("user_courses")
      .select("course_id, status, created_at, courses!inner(course_code, title)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    admin
      .from("ai_generations")
      .select("id, course_id, item_type, generated_text, category, target_role, is_public, created_at, courses!inner(course_code, title)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    admin
      .from("user_course_history")
      .select("id, course_id, term_year, term_semester, section, offering_id, course_offerings(offering_professors(professors(name)))")
      .eq("user_id", user.id)
      .order("term_year", { ascending: false })
      .order("term_semester"),
  ]);

  const loadError = courseResult.error?.message ?? itemResult.error?.message ?? historyResult.error?.message ?? "";
  const courseRows = (courseResult.data ?? []) as UserCourseRow[];
  const savedItems = (itemResult.data ?? []) as SavedItemRow[];
  const uniqueCourses = Array.from(
    new Map(courseRows.map((row) => [row.course_id, row])).values(),
  );
  const savedSkills = savedItems.filter((item) => item.item_type === "skill");
  const savedBullets = savedItems.filter(
    (item) => item.item_type === "resume_bullet",
  );
  const courseHistory = (historyResult.data ?? []) as CourseHistoryRow[];
  const historyByCourse = new Map<string, CourseHistoryRow[]>();
  for (const history of courseHistory) {
    const rows = historyByCourse.get(history.course_id) ?? [];
    rows.push(history);
    historyByCourse.set(history.course_id, rows);
  }
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
          <h1>Your profile</h1>
          <p>Your courses, saved skills, and resume bullets in one place.</p>
        </div>
        <div className="dashboard-counts" aria-label="Profile totals">
          <span><strong>{uniqueCourses.length}</strong> courses</span>
          <span><strong>{savedSkills.length}</strong> skills</span>
        </div>
      </div>

      {loadError ? (
        <div className="message error" role="alert">
          Could not load all profile data: {loadError}
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
                  <strong
                    className="dashboard-skill-name"
                    tabIndex={0}
                    data-course={`${course.course_code} · ${course.title}`}
                    title={`${course.course_code} · ${course.title}`}
                  >{item.generated_text}</strong>
                  <span className="dashboard-item-meta">
                    {course.course_code} · {course.title}
                    {item.category ? ` · ${formatStatus(item.category)}` : ""}
                  </span>
                  <span className="dashboard-item-meta">Role: {item.target_role}</span>
                  <ProfileDeleteButton
                    kind="item"
                    id={item.id}
                    itemType="skill"
                    isPublic={item.is_public}
                    label={item.generated_text ?? "saved skill"}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="dashboard-empty">No saved skills yet.</p>
        )}
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
              const courseBullets = savedBullets.filter(
                (item) => item.course_id === row.course_id,
              );
              const courseSkills = savedSkills.filter((item) => item.course_id === row.course_id);
              const courseHistoryRows = [...(historyByCourse.get(row.course_id) ?? [])].sort(
                (left, right) =>
                  right.term_year - left.term_year ||
                  semesterOrder(right.term_semester) - semesterOrder(left.term_semester) ||
                  left.section.localeCompare(right.section),
              );
              const latestHistory = courseHistoryRows[0];
              return (
                <li className="dashboard-course-entry" key={row.course_id}>
                  <details className="dashboard-course-accordion">
                    <summary>
                      <span className="dashboard-course-title">
                        <strong>{course.course_code}</strong>
                        <span>{course.title}</span>
                      </span>
                      <span className="dashboard-course-summary-meta">
                        <span className="dashboard-status">{formatStatus(row.status)}</span>
                        <span>
                          {courseHistoryRows.length} {courseHistoryRows.length === 1 ? "section" : "sections"}
                          {" · "}{courseSkills.length} {courseSkills.length === 1 ? "skill" : "skills"}
                          {" · "}{courseBullets.length} {courseBullets.length === 1 ? "bullet" : "bullets"}
                        </span>
                      </span>
                    </summary>
                    <div className="dashboard-course-actions">
                      <Link
                        className="dashboard-draft-link"
                        href={getDraftHref(row.course_id, latestHistory?.id)}
                      >
                        Draft from this course
                        {latestHistory
                          ? ` · ${latestHistory.term_semester} ${latestHistory.term_year} · Section ${latestHistory.section || "not listed"}`
                          : ""}
                      </Link>
                    </div>
                    {courseHistoryRows.length ? (
                      <section className="dashboard-course-detail-section">
                        <h3>Course history</h3>
                        <ul className="dashboard-course-history">
                          {courseHistoryRows.map((history, historyIndex) => {
                            const professors = getProfessorNames(history.course_offerings);
                            return (
                              <li key={history.id}>
                                <span className="dashboard-history-field">
                                  <small>Term</small>
                                  <strong>{history.term_semester} {history.term_year}</strong>
                                </span>
                                <span className="dashboard-history-field">
                                  <small>Section</small>
                                  <strong>{history.section || "Not listed"}</strong>
                                </span>
                                <span className="dashboard-history-field dashboard-history-professor">
                                  <small>Professor</small>
                                  <strong>{professors.length ? professors.join(", ") : "Not matched"}</strong>
                                </span>
                                {historyIndex > 0 ? (
                                  <Link
                                    className="dashboard-history-draft-link"
                                    href={getDraftHref(row.course_id, history.id)}
                                  >
                                    Draft from this section
                                  </Link>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ) : null}
                    <section className="dashboard-course-detail-section">
                      <h3>Resume bullets</h3>
                      {courseBullets.length ? (
                        <ul className="dashboard-course-bullets">
                          {courseBullets.map((item) => (
                            <li key={item.id}>
                              <strong>{item.generated_text}</strong>
                              <span className="dashboard-item-meta">Role: {item.target_role}</span>
                              <ProfileDeleteButton
                                kind="item"
                                id={item.id}
                                itemType="resume_bullet"
                                isPublic={item.is_public}
                                label={item.generated_text ?? "resume bullet"}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="dashboard-empty dashboard-course-empty">
                          No saved resume bullets for this course yet.
                        </p>
                      )}
                    </section>
                    <ProfileDeleteButton
                      kind="course"
                      id={row.course_id}
                      label={`${course.course_code} · ${course.title}`}
                      skillCount={courseSkills.length}
                      bulletCount={courseBullets.length}
                      sectionCount={courseHistoryRows.length}
                    />
                  </details>
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

      <CourseHistoryImport />
    </section>
  );
}
