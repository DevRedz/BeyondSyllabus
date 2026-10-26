"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type CourseSkill = {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  name: string;
  sourceType: string;
  evidence: string | null;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  userVote: 1 | -1 | null;
};

type Props = {
  isSignedIn: boolean;
};

export default function CourseSkills({ isSignedIn }: Props) {
  const [skills, setSkills] = useState<CourseSkill[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [voteError, setVoteError] = useState("");
  const [pendingVote, setPendingVote] = useState<string | null>(null);
  const [expandedSkillIds, setExpandedSkillIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();

    async function loadSkills() {
      try {
        const response = await fetch("/api/course-skills", {
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          skills?: CourseSkill[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? "Unable to load course skills.");
        }
        setSkills(result.skills ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadingError(
          error instanceof Error ? error.message : "Unable to load course skills.",
        );
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadSkills();
    return () => controller.abort();
  }, []);

  const courses = useMemo(
    () =>
      Array.from(
        new Map(
          skills.map((skill) => [
            skill.courseId,
            { id: skill.courseId, label: `${skill.courseCode} · ${skill.courseTitle}` },
          ]),
        ).values(),
      ).sort((left, right) => left.label.localeCompare(right.label)),
    [skills],
  );

  const visibleSkills = useMemo(() => {
    const query = search.trim().toLowerCase();
    return skills.filter((skill) => {
      if (selectedCourse && skill.courseId !== selectedCourse) return false;
      if (!query) return true;
      return (
        skill.name.toLowerCase().includes(query) ||
        skill.courseCode.toLowerCase().includes(query) ||
        skill.courseTitle.toLowerCase().includes(query) ||
        (skill.evidence ?? "").toLowerCase().includes(query)
      );
    });
  }, [search, selectedCourse, skills]);

  async function castVote(skill: CourseSkill, desiredVote: 1 | -1) {
    if (!isSignedIn) {
      setVoteError("Sign in and complete the course to vote on its skills.");
      return;
    }

    setVoteError("");
    setPendingVote(skill.id);
    const vote = skill.userVote === desiredVote ? null : desiredVote;
    try {
      const response = await fetch(`/api/course-skills/${skill.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      const result = (await response.json()) as {
        userVote?: 1 | -1 | null;
        upvotes?: number;
        downvotes?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save your vote.");
      }
      setSkills((current) =>
        current.map((item) =>
          item.id === skill.id
            ? {
                ...item,
                userVote: result.userVote ?? null,
                upvotes: result.upvotes ?? item.upvotes,
                downvotes: result.downvotes ?? item.downvotes,
              }
            : item,
        ),
      );
    } catch (error) {
      setVoteError(
        error instanceof Error ? error.message : "Unable to save your vote.",
      );
    } finally {
      setPendingVote(null);
    }
  }

  return (
    <section className="skills-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">Peer-reviewed skills</p>
          <h1>Course skills</h1>
          <p className="skills-intro">
            Explore skills drawn from course materials. Upvote or downvote skills
            for courses you have completed.
          </p>
        </div>
        <span className="row-count">{visibleSkills.length} skills</span>
      </div>

      <div className="skills-filters">
        <label>
          <span>Search skills</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Skill, course, or evidence"
          />
        </label>
        <label>
          <span>Course</span>
          <select
            value={selectedCourse}
            onChange={(event) => setSelectedCourse(event.target.value)}
          >
            <option value="">All courses</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>{course.label}</option>
            ))}
          </select>
        </label>
      </div>

      {voteError ? (
        <div className="message error skills-error" role="alert">{voteError}</div>
      ) : null}
      {loadingError ? (
        <div className="message error" role="alert">{loadingError}</div>
      ) : isLoading ? (
        <p className="message">Loading course skills...</p>
      ) : visibleSkills.length === 0 ? (
        <p className="message">
          {skills.length
            ? "No skills match these filters."
            : "No course skills have been added yet."}
        </p>
      ) : (
        <div className="table-wrap skills-table-wrap">
          <table className="skills-table">
            <thead>
              <tr>
                <th scope="col">Skill</th>
                <th scope="col">Course</th>
                <th scope="col">Community votes</th>
              </tr>
            </thead>
            <tbody>
              {visibleSkills.map((skill) => {
                const isExpanded = expandedSkillIds.has(skill.id);
                const detailsId = `skill-details-${skill.id}`;
                return (
                  <Fragment key={skill.id}>
                    <tr>
                      <td className="skill-name-cell">
                        {skill.name}
                        <button
                          className="skill-details-toggle"
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          onClick={() =>
                            setExpandedSkillIds((current) => {
                              const next = new Set(current);
                              if (next.has(skill.id)) next.delete(skill.id);
                              else next.add(skill.id);
                              return next;
                            })
                          }
                        >
                          {isExpanded ? "Hide details" : "Details"}
                        </button>
                      </td>
                      <td>
                        <strong>{skill.courseCode}</strong>
                        <span className="skill-course-title">{skill.courseTitle}</span>
                      </td>
                      <td>
                        <div className="skill-votes" aria-label={`Votes for ${skill.name}`}>
                          <button
                            className={`vote-button${skill.userVote === 1 ? " selected" : ""}`}
                            type="button"
                            aria-label={`Upvote ${skill.name}`}
                            aria-pressed={skill.userVote === 1}
                            disabled={pendingVote === skill.id}
                            onClick={() => void castVote(skill, 1)}
                          >
                            <span aria-hidden="true">▲</span> {skill.upvotes}
                          </button>
                          <button
                            className={`vote-button${skill.userVote === -1 ? " selected" : ""}`}
                            type="button"
                            aria-label={`Downvote ${skill.name}`}
                            aria-pressed={skill.userVote === -1}
                            disabled={pendingVote === skill.id}
                            onClick={() => void castVote(skill, -1)}
                          >
                            <span aria-hidden="true">▼</span> {skill.downvotes}
                          </button>
                        </div>
                        {!isSignedIn ? (
                          <span className="vote-hint">Sign in to vote</span>
                        ) : null}
                      </td>
                    </tr>
                    <tr
                      id={detailsId}
                      className="skill-details-row"
                      hidden={!isExpanded}
                    >
                      <td colSpan={3}>
                        <div className="skill-details-content">
                          <span className="source-badge">
                            {skill.sourceType.replaceAll("_", " ")}
                          </span>
                          {skill.evidence ? (
                            <p className="skill-evidence">{skill.evidence}</p>
                          ) : (
                            <p className="skill-evidence">No evidence provided.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
