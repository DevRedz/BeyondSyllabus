"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  getTargetRoleError,
  MAX_TARGET_ROLE_LENGTH,
  normalizeTargetRole,
} from "../lib/target-role";
import {
  CURRENT_YEAR,
  getOfferingYearError,
  MIN_OFFERING_YEAR,
} from "../lib/offering-year";

type Course = {
  id: string;
  course_code: string;
  title: string;
};

type CourseOffering = {
  id: string;
  semester: string;
  year: number;
  professors: string[];
  has_syllabus: boolean;
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

function professorGroupKey(professors: string[]) {
  return JSON.stringify(professors.map((name) => name.toLocaleLowerCase()).sort());
}

function parseProfessorNames(value: string) {
  return value
    .split(/\s*(?:,|;|\band\b|\n)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
}

export default function CourseCuration({ courses, isSignedIn }: Props) {
  const [courseSearch, setCourseSearch] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [offerings, setOfferings] = useState<CourseOffering[]>([]);
  const [selectedOfferingYear, setSelectedOfferingYear] = useState("");
  const [selectedOfferingSemester, setSelectedOfferingSemester] = useState("");
  const [selectedProfessors, setSelectedProfessors] = useState<string[]>([]);
  const [professorQuery, setProfessorQuery] = useState("");
  const [professorSuggestions, setProfessorSuggestions] = useState<string[]>([]);
  const [isSearchingProfessors, setIsSearchingProfessors] = useState(false);
  const [professorSearchError, setProfessorSearchError] = useState("");
  const [isProfessorInputFocused, setIsProfessorInputFocused] = useState(false);
  const [isLoadingOfferings, setIsLoadingOfferings] = useState(false);
  const [offeringError, setOfferingError] = useState("");
  const [targetRole, setTargetRole] = useState("");
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
  const targetRoleError = targetRole.trim() ? getTargetRoleError(targetRole) : "";
  const offeringYearError = getOfferingYearError(selectedOfferingYear);
  const availableSemesters = Array.from(
    new Set([...offerings.map((offering) => offering.semester), "Spring", "Summer", "Fall", "Winter"]),
  ).sort();
  const activeProfessorQuery = professorQuery.trim();
  const selectedProfessorGroup = professorGroupKey([
    ...selectedProfessors,
    ...parseProfessorNames(professorQuery),
  ]);
  const hasAnyOfferingSelection = Boolean(
    selectedOfferingYear || selectedOfferingSemester || selectedProfessors.length || professorQuery.trim(),
  );
  const hasCompleteOfferingSelection = Boolean(
    selectedOfferingYear && selectedOfferingSemester && (selectedProfessors.length || professorQuery.trim()),
  );
  const hasPartialOfferingSelection =
    hasAnyOfferingSelection && !hasCompleteOfferingSelection;
  const selectedOfferingMatches = offerings.filter(
    (offering) =>
      String(offering.year) === selectedOfferingYear &&
      offering.semester === selectedOfferingSemester &&
      professorGroupKey(offering.professors) === selectedProfessorGroup,
  );
  const selectedOffering =
    selectedOfferingMatches.find((offering) => offering.has_syllabus) ??
    selectedOfferingMatches[0];
  const matchingSyllabusExists = selectedOfferingMatches.some(
    (offering) => offering.has_syllabus,
  );

  useEffect(() => {
    if (!selectedCourse) {
      setOfferings([]);
      setSelectedOfferingYear("");
      setSelectedOfferingSemester("");
      setSelectedProfessors([]);
      setProfessorQuery("");
      setOfferingError("");
      setIsLoadingOfferings(false);
      return;
    }

    const controller = new AbortController();
    setOfferings([]);
    setSelectedOfferingYear("");
    setSelectedOfferingSemester("");
    setSelectedProfessors([]);
    setProfessorQuery("");
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

  useEffect(() => {
    if (activeProfessorQuery.length < 2) {
      setProfessorSuggestions([]);
      setIsSearchingProfessors(false);
      setProfessorSearchError("");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsSearchingProfessors(true);
      setProfessorSearchError("");
      try {
        const response = await fetch(
          `/api/professors?q=${encodeURIComponent(activeProfessorQuery)}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as {
          professors?: string[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? "Unable to search professors.");
        }
        setProfessorSuggestions(result.professors ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProfessorSuggestions([]);
        setProfessorSearchError(
          error instanceof Error ? error.message : "Unable to search professors.",
        );
      } finally {
        if (!controller.signal.aborted) setIsSearchingProfessors(false);
      }
    }, 180);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [activeProfessorQuery]);

  function resetAnalysis() {
    setAnalysis(null);
    setSelectedSkills(new Set());
    setSelectedBullets(new Set());
    setSuccessMessage("");
  }

  function chooseCourse(course: Course) {
    setSelectedCourse(course);
    setSelectedOfferingYear("");
    setSelectedOfferingSemester("");
    setSelectedProfessors([]);
    setProfessorQuery("");
    setCourseSearch("");
    resetAnalysis();
  }

  function addProfessorNames(names: string[]) {
    const cleanedNames = names.map((name) => name.trim()).filter(Boolean);
    setSelectedProfessors((current) => {
      const existingNames = new Set(current.map((name) => name.toLocaleLowerCase()));
      const newNames = cleanedNames.filter((name) => {
        const normalizedName = name.toLocaleLowerCase();
        if (existingNames.has(normalizedName)) return false;
        existingNames.add(normalizedName);
        return true;
      });
      return [...current, ...newNames];
    });
  }

  function chooseProfessorSuggestion(professor: string) {
    addProfessorNames([professor]);
    setProfessorQuery("");
    setProfessorSuggestions([]);
  }

  function handleProfessorQueryChange(value: string) {
    const segments = value.split(/[,;\n]/);
    if (segments.length > 1) {
      addProfessorNames(segments.slice(0, -1));
      setProfessorQuery(segments.at(-1) ?? "");
      return;
    }
    setProfessorQuery(value);
  }

  function handleProfessorKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== "," && event.key !== ";") return;
    event.preventDefault();
    addProfessorNames(parseProfessorNames(professorQuery));
    setProfessorQuery("");
    setProfessorSuggestions([]);
  }

  function removeProfessor(nameToRemove: string) {
    setSelectedProfessors((current) =>
      current.filter((name) => name.toLocaleLowerCase() !== nameToRemove.toLocaleLowerCase()),
    );
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
      setErrorMessage("Sign in before generating a draft.");
      return;
    }
    if (!selectedCourse) {
      setErrorMessage("Choose a course first.");
      return;
    }
    if (targetRoleError) {
      setErrorMessage(targetRoleError);
      return;
    }
    if (offeringYearError) {
      setErrorMessage(offeringYearError);
      return;
    }
    if (hasPartialOfferingSelection) {
      setErrorMessage("Choose a year, semester, and professor, or clear all three.");
      return;
    }
    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.set("courseId", selectedCourse.id);
      if (selectedOfferingYear) formData.set("offeringYear", selectedOfferingYear);
      if (selectedOffering) formData.set("offeringId", selectedOffering.id);
      if (syllabusFile) formData.set("syllabus", syllabusFile);
      const normalizedTargetRole = normalizeTargetRole(targetRole);
      if (normalizedTargetRole) formData.set("targetRole", normalizedTargetRole);
      const response = await fetch("/api/ai/extract", {
        method: "POST",
        body: formData,
      });
      let result: {
        analysis?: Analysis;
        model?: string;
        error?: string;
      };
      try {
        result = (await response.json()) as typeof result;
      } catch {
        throw new Error("The server could not process the draft request. Please try again.");
      }
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
    if (targetRoleError) {
      setErrorMessage(targetRoleError);
      return;
    }
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
          targetRole: normalizeTargetRole(targetRole),
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
            Generate a short draft from the course description or a syllabus, then
            choose only the skills and statements that reflect your experience.
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
            <fieldset className="offering-selection">
              <legend>Course offering (optional)</legend>
              <div className="offering-fields">
                <div className="form-field">
                  <label htmlFor="offering-year">Year</label>
                  <input
                    id="offering-year"
                    type="number"
                    min={MIN_OFFERING_YEAR}
                    max={CURRENT_YEAR}
                    step="1"
                    value={selectedOfferingYear}
                    onChange={(event) => {
                      setSelectedOfferingYear(event.target.value);
                      setSelectedOfferingSemester("");
                      setSelectedProfessors([]);
                      setProfessorQuery("");
                    }}
                    placeholder="Enter any year"
                    aria-label="Offering year"
                    aria-invalid={Boolean(offeringYearError)}
                    aria-describedby="offering-year-hint"
                  />
                  <span id="offering-year-hint" className="field-hint">
                    {offeringYearError || `Enter a year from ${MIN_OFFERING_YEAR} to ${CURRENT_YEAR}.`}
                  </span>
                </div>
                <div className="form-field">
                  <label htmlFor="offering-semester">Semester</label>
                  <select
                    id="offering-semester"
                    value={selectedOfferingSemester}
                    onChange={(event) => {
                      setSelectedOfferingSemester(event.target.value);
                      setSelectedProfessors([]);
                      setProfessorQuery("");
                    }}
                    disabled={!selectedOfferingYear.trim()}
                  >
                    <option value="">Select semester</option>
                    {availableSemesters.map((semester) => (
                      <option key={semester} value={semester}>{semester}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="offering-professors">Professor(s)</label>
                  <div
                    className="professor-autocomplete"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                        setIsProfessorInputFocused(false);
                      }
                    }}
                    onFocus={() => setIsProfessorInputFocused(true)}
                  >
                    <div className="professor-token-list">
                      {selectedProfessors.map((professor) => (
                        <span className="professor-token" key={professor}>
                          <span>{professor}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${professor}`}
                            title={`Remove ${professor}`}
                            onClick={() => removeProfessor(professor)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        id="offering-professors"
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-controls="professor-suggestions"
                        aria-expanded={isProfessorInputFocused && activeProfessorQuery.length >= 2}
                        value={professorQuery}
                        onChange={(event) => handleProfessorQueryChange(event.target.value)}
                        onKeyDown={handleProfessorKeyDown}
                        disabled={!selectedOfferingSemester}
                        placeholder={selectedProfessors.length ? "Add professor" : "Search or enter professor(s)"}
                        autoComplete="off"
                      />
                    </div>
                    {isProfessorInputFocused && activeProfessorQuery.length >= 2 ? (
                      <ul
                        id="professor-suggestions"
                        className="professor-suggestions"
                        role="listbox"
                        aria-label="Matching professors"
                      >
                        {isSearchingProfessors ? (
                          <li className="professor-suggestion-message" role="status">
                            Searching professors...
                          </li>
                        ) : professorSearchError ? (
                          <li className="professor-suggestion-message" role="status">
                            Suggestions unavailable. You can still enter a name manually.
                          </li>
                        ) : professorSuggestions.length ? (
                          professorSuggestions.map((professor) => (
                            <li key={professor}>
                              <button
                                type="button"
                                role="option"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => chooseProfessorSuggestion(professor)}
                              >
                                {professor}
                              </button>
                            </li>
                          ))
                        ) : (
                          <li className="professor-suggestion-message" role="status">
                            No matches. Keep typing to enter the name manually.
                          </li>
                        )}
                      </ul>
                    ) : null}
                  </div>
                  <p className="field-hint">Search names from the professor list, or enter multiple names separated by commas.</p>
                </div>
              </div>
              {offeringError ? (
                <p className="field-hint error-text" role="alert">{offeringError}</p>
              ) : offeringYearError ? (
                <p className="field-hint error-text" role="alert">{offeringYearError}</p>
              ) : hasPartialOfferingSelection ? (
                <p className="field-hint" role="status">
                  Choose all three fields, or leave all three blank.
                </p>
              ) : hasCompleteOfferingSelection && selectedOfferingMatches.length > 0 ? (
                <p
                  className={`field-hint syllabus-status ${matchingSyllabusExists ? "available" : "unavailable"}`}
                  role={matchingSyllabusExists || syllabusFile ? "status" : "alert"}
                >
                  {matchingSyllabusExists
                    ? selectedOfferingMatches.length > 1
                      ? "Syllabus on file for one or more matching offerings."
                      : "Syllabus on file for this offering."
                    : syllabusFile
                      ? "No syllabus is on file for this offering. Your uploaded PDF will be used for this draft."
                      : "You should provide your syllabus below. Otherwise, the draft will be generated solely from the general course description, which is generic across offerings."}
                </p>
              ) : hasCompleteOfferingSelection && selectedOfferingMatches.length === 0 ? (
                <p
                  className="field-hint syllabus-status unavailable"
                  role={syllabusFile ? "status" : "alert"}
                >
                  {syllabusFile
                    ? "This offering is not in the program database. Your uploaded syllabus will be used for this draft."
                    : "You should provide your syllabus below. Otherwise, the draft will be generated solely from the general course description, which is generic across offerings."}
                </p>
              ) : hasCompleteOfferingSelection ? (
                <p className="field-hint error-text" role="alert">
                  No matching course offering found.
                </p>
              ) : isLoadingOfferings ? (
                <p className="field-hint" role="status">Loading course offerings...</p>
              ) : offerings.length === 0 ? (
                <p className="field-hint">No offerings are listed for this course.</p>
              ) : (
                <p className="field-hint">
                  Select all three to check whether its syllabus is on file, or leave them blank to use the course description.
                </p>
              )}
            </fieldset>
          ) : null}

          <div className="form-field">
            <label htmlFor="target-role">Target role (optional)</label>
            <input
              id="target-role"
              maxLength={MAX_TARGET_ROLE_LENGTH}
              value={targetRole}
              onChange={(event) => setTargetRole(event.target.value)}
              placeholder="e.g. Product designer"
              aria-invalid={Boolean(targetRoleError)}
              aria-describedby="target-role-hint"
            />
            <p
              id="target-role-hint"
              className={`field-hint${targetRoleError ? " error-text" : ""}`}
              role={targetRoleError ? "alert" : undefined}
            >
              {targetRoleError || "Add a role to tailor the draft, or leave blank for a general draft."}
            </p>
          </div>

          <div className="form-field">
            <label htmlFor="syllabus-pdf">Syllabus PDF (optional)</label>
            <input
              id="syllabus-pdf"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleSyllabusChange}
            />
            <p className="field-hint">
              PDF only, maximum 4 MB. Without a PDF, the course catalog description is used.
            </p>
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
              hasPartialOfferingSelection ||
              Boolean(targetRoleError) ||
              Boolean(offeringYearError) ||
              isGenerating
            }
          >
            {isGenerating ? "Generating draft..." : "Generate a short draft"}
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
            <p>Choose a course to generate a draft from its catalog description, or add a syllabus for more detail.</p>
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
                disabled={!isSignedIn || selectedCount === 0 || Boolean(targetRoleError) || isSaving}
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
