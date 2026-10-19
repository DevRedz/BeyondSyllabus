"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

type Course = {
  id: string;
  course_code: string;
  title: string;
};

type CourseOffering = {
  id: string;
  semester: string;
  year: number;
  offering_identity_key: string;
};

type Skill = {
  name: string;
  evidence: string;
};

type SkillCategory = {
  category: string;
  skills: Skill[];
};

type Analysis = {
  course_name: string;
  source_readable: boolean;
  skillsets: SkillCategory[];
  resume_bullets: string[];
};

type Props = {
  courses: Course[];
  isSignedIn: boolean;
};

type Tab = "skills" | "bullets";

function skillKey(category: string, name: string) {
  return `${category}\u0000${name}`;
}

export default function CourseCuration({ courses, isSignedIn }: Props) {
  const [courseSearch, setCourseSearch] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [offerings, setOfferings] = useState<CourseOffering[]>([]);
  const [selectedOfferingId, setSelectedOfferingId] = useState("");
  const [isLoadingOfferings, setIsLoadingOfferings] = useState(false);
  const [offeringError, setOfferingError] = useState("");
  const [targetRole, setTargetRole] = useState("General software role");
  const [syllabusFile, setSyllabusFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [model, setModel] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("skills");
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [selectedBullets, setSelectedBullets] = useState<Set<number>>(new Set());
  const [shareSelectedItems, setShareSelectedItems] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const matchingCourses = useMemo(() => {
    const query = courseSearch.trim().toLowerCase();
    if (query.length < 2 || selectedCourse) return [];
    return courses
      .filter(
        (course) =>
          course.course_code.toLowerCase().includes(query) ||
          course.title.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [courseSearch, courses, selectedCourse]);

  const skillCount = analysis?.skillsets.reduce(
    (total, category) => total + category.skills.length,
    0,
  ) ?? 0;
  const selectedCount = selectedSkills.size + selectedBullets.size;

  useEffect(() => {
    if (!selectedCourse) {
      setOfferings([]);
      setSelectedOfferingId("");
      setOfferingError("");
      setIsLoadingOfferings(false);
      return;
    }

    const controller = new AbortController();
    setOfferings([]);
    setSelectedOfferingId("");
    setOfferingError("");
    setIsLoadingOfferings(true);

    async function loadOfferings() {
      try {
        const response = await fetch(
          `/api/course-offerings?courseId=${encodeURIComponent(selectedCourse.id)}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as {
          offerings?: CourseOffering[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? "Unable to load course offerings.");
        }
        setOfferings(result.offerings ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setOfferingError(
          error instanceof Error ? error.message : "Unable to load course offerings.",
        );
      } finally {
        if (!controller.signal.aborted) setIsLoadingOfferings(false);
      }
    }

    void loadOfferings();
    return () => controller.abort();
  }, [selectedCourse]);

  function resetAnalysis() {
    setAnalysis(null);
    setSelectedSkills(new Set());
    setSelectedBullets(new Set());
    setSuccessMessage("");
  }

  function chooseCourse(course: Course) {
    setSelectedCourse(course);
    setCourseSearch("");
    resetAnalysis();
  }

  function handleSyllabusChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setSyllabusFile(nextFile);
    resetAnalysis();
    setErrorMessage("");
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    if (!isSignedIn) {
      setErrorMessage("Sign in before analyzing a syllabus.");
      return;
    }
    if (!selectedCourse || !syllabusFile) {
      setErrorMessage("Choose a course and syllabus PDF first.");
      return;
    }
    if (!selectedOfferingId) {
      setErrorMessage("Choose a course offering first.");
      return;
    }

    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.set("courseId", selectedCourse.id);
      formData.set("offeringId", selectedOfferingId);
      formData.set("syllabus", syllabusFile);
      const response = await fetch("/api/ai/extract", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        analysis?: Analysis;
        model?: string;
        error?: string;
      };
      if (!response.ok || !result.analysis) {
        throw new Error(result.error ?? "Unable to analyze this PDF.");
      }
      setAnalysis(result.analysis);
      setModel(result.model ?? "");
      setSelectedSkills(new Set());
      setSelectedBullets(new Set());
      setActiveTab("skills");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to analyze this PDF.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function toggleSkill(category: string, name: string) {
    const key = skillKey(category, name);
    setSelectedSkills((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleBullet(index: number) {
    setSelectedBullets((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function saveSelection() {
    if (!analysis || !selectedCourse || selectedCount === 0) return;
    setErrorMessage("");
    setSuccessMessage("");
    setIsSaving(true);
    try {
      const skills = analysis.skillsets.flatMap((category) =>
        category.skills
          .filter((skill) =>
            selectedSkills.has(skillKey(category.category, skill.name)),
          )
          .map((skill) => ({
            category: category.category,
            name: skill.name,
            evidence: skill.evidence,
          })),
      );
      const bullets = Array.from(selectedBullets)
        .sort((left, right) => left - right)
        .map((index) => analysis.resume_bullets[index]);
      const response = await fetch("/api/ai/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: selectedCourse.id,
          targetRole: targetRole.trim(),
          model,
          skills,
          bullets,
          shareSelectedItems,
        }),
      });
      const result = (await response.json()) as {
        insertedSkills?: number;
        insertedBullets?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Unable to save selections.");
      setSuccessMessage(
        `Saved ${result.insertedSkills ?? 0} new skills and ${result.insertedBullets ?? 0} new resume bullets.`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save selections.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="curation-layout">
      <section className="curation-controls" aria-labelledby="curation-title">
        <div className="curation-intro">
          <p className="eyebrow">Syllabus to portfolio</p>
          <h1 id="curation-title">Keep what you can stand behind.</h1>
          <p className="curation-description">
            Generate a short draft from your syllabus, then choose only the skills
            and statements that reflect your experience.
          </p>
        </div>

        <form className="analysis-form" onSubmit={generate}>
          <div className="form-field course-field">
            <label htmlFor="course-search">Course</label>
            {selectedCourse ? (
              <div className="selected-course">
                <span>
                  <strong>{selectedCourse.course_code}</strong>
                  {selectedCourse.title}
                </span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setSelectedCourse(null);
                    resetAnalysis();
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  id="course-search"
                  autoComplete="off"
                  value={courseSearch}
                  onChange={(event) => setCourseSearch(event.target.value)}
                  placeholder="Search by course code or title"
                />
                {matchingCourses.length > 0 ? (
                  <ul className="course-suggestions" role="listbox" aria-label="Matching courses">
                    {matchingCourses.map((course) => (
                      <li key={course.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected="false"
                          onClick={() => chooseCourse(course)}
                        >
                          <strong>{course.course_code}</strong>
                          <span>{course.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : courseSearch.trim().length >= 2 ? (
                  <p className="field-hint">No matching course found.</p>
                ) : null}
              </>
            )}
          </div>

          {selectedCourse ? (
            <div className="form-field">
              <label htmlFor="course-offering">Course offering</label>
              <select
                id="course-offering"
                value={selectedOfferingId}
                onChange={(event) => setSelectedOfferingId(event.target.value)}
                disabled={isLoadingOfferings || offerings.length === 0}
              >
                <option value="">
                  {isLoadingOfferings
                    ? "Loading offerings..."
                    : offerings.length
                      ? "Choose a semester and instructor set"
                      : "No offerings available"}
                </option>
                {offerings.map((offering) => (
                  <option key={offering.id} value={offering.id}>
                    {offering.semester} {offering.year} · {offering.offering_identity_key}
                  </option>
                ))}
              </select>
              {offeringError ? (
                <p className="field-hint error-text" role="alert">{offeringError}</p>
              ) : offerings.length > 0 ? (
                <p className="field-hint">
                  Instructor identity distinguishes offerings in the same term.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="form-field">
            <label htmlFor="target-role">Target role</label>
            <input
              id="target-role"
              maxLength={120}
              value={targetRole}
              onChange={(event) => setTargetRole(event.target.value)}
              placeholder="e.g. Product designer"
            />
          </div>

          <div className="form-field">
            <label htmlFor="syllabus-pdf">Syllabus PDF</label>
            <input
              id="syllabus-pdf"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleSyllabusChange}
            />
            <p className="field-hint">PDF only. Maximum 4 MB.</p>
          </div>

          {!isSignedIn ? (
            <p className="field-hint auth-required">
              Sign in with Google to analyze and save selected results.
            </p>
          ) : null}
          <button
            className="primary-action"
            type="submit"
            disabled={
              !isSignedIn ||
              !selectedCourse ||
              !selectedOfferingId ||
              !syllabusFile ||
              isGenerating
            }
          >
            {isGenerating ? "Reading syllabus..." : "Generate a short draft"}
          </button>
        </form>
      </section>

      <section className="curation-results" aria-label="Generated results">
        {errorMessage ? (
          <div className="message error" role="alert">{errorMessage}</div>
        ) : null}
        {successMessage ? (
          <div className="message success" role="status">{successMessage}</div>
        ) : null}

        {!analysis ? (
          <div className="empty-preview">
            <span className="empty-preview-index">01</span>
            <h2>Your review queue</h2>
            <p>Choose a course and upload a syllabus to generate a focused draft.</p>
            <div className="limit-note">
              <span>Up to 3 skill categories</span>
              <span>4 skills per category</span>
              <span>5 resume bullets</span>
            </div>
          </div>
        ) : (
          <>
            <div className="review-heading">
              <div>
                <p className="eyebrow">Review draft</p>
                <h2>{analysis.course_name || selectedCourse?.title}</h2>
              </div>
              <span className="selection-count">{selectedCount} selected</span>
            </div>

            <div className="review-tabs" role="tablist" aria-label="Generated content">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "skills"}
                className={activeTab === "skills" ? "active" : ""}
                onClick={() => setActiveTab("skills")}
              >
                Skills <span>{skillCount}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "bullets"}
                className={activeTab === "bullets" ? "active" : ""}
                onClick={() => setActiveTab("bullets")}
              >
                Resume bullets <span>{analysis.resume_bullets.length}</span>
              </button>
            </div>

            {activeTab === "skills" ? (
              <div className="review-list" role="tabpanel">
                {analysis.skillsets.length === 0 ? (
                  <p className="message">No evidence-backed skills were found in this image.</p>
                ) : (
                  analysis.skillsets.map((category) => (
                    <section className="skill-category" key={category.category}>
                      <h3>{category.category.replace(/_/g, " ")}</h3>
                      {category.skills.map((skill) => {
                        const key = skillKey(category.category, skill.name);
                        return (
                          <label className="review-item skill-item" key={key}>
                            <input
                              type="checkbox"
                              checked={selectedSkills.has(key)}
                              onChange={() => toggleSkill(category.category, skill.name)}
                            />
                            <span className="review-item-copy">
                              <strong>{skill.name}</strong>
                              <span>{skill.evidence}</span>
                            </span>
                          </label>
                        );
                      })}
                    </section>
                  ))
                )}
              </div>
            ) : (
              <div className="review-list" role="tabpanel">
                {analysis.resume_bullets.map((bullet, index) => (
                  <label className="review-item bullet-item" key={`${index}-${bullet}`}>
                    <input
                      type="checkbox"
                      checked={selectedBullets.has(index)}
                      onChange={() => toggleBullet(index)}
                    />
                    <span className="review-item-copy">{bullet}</span>
                  </label>
                ))}
              </div>
            )}

            <label className="share-option">
              <input
                type="checkbox"
                checked={shareSelectedItems}
                onChange={(event) => setShareSelectedItems(event.target.checked)}
              />
              <span>Share selected skills and bullets publicly for community voting</span>
            </label>

            <div className="save-row">
              <span>Nothing is saved until you select it.</span>
              <button
                className="primary-action"
                type="button"
                disabled={!isSignedIn || selectedCount === 0 || isSaving}
                onClick={saveSelection}
              >
                {isSaving ? "Saving..." : "Save selected"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
