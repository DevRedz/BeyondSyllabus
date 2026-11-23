"use client";

import { useEffect, useMemo, useState } from "react";

type CommunityItem = {
  id: string;
  kind: "skill" | "resume_bullet";
  courseId: string;
  courseCode: string;
  courseTitle: string;
  professors: string[];
  name: string;
  sourceType?: string;
  evidence?: string | null;
  targetRole?: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  userVote: 1 | -1 | null;
  canVote: boolean;
};

type CourseGroup = {
  id: string;
  code: string;
  title: string;
  canVote: boolean;
  items: CommunityItem[];
};

type Props = { isSignedIn: boolean };

function popularity(item: CommunityItem) {
  return item.upvotes - item.downvotes;
}

export default function CourseSkills({ isSignedIn }: Props) {
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [search, setSearch] = useState("");
  const [completedOnly, setCompletedOnly] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [voteError, setVoteError] = useState("");
  const [pendingVote, setPendingVote] = useState<string | null>(null);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    async function loadItems() {
      try {
        const response = await fetch("/api/course-skills", { signal: controller.signal });
        const result = (await response.json()) as {
          skills?: CommunityItem[];
          resumeBullets?: CommunityItem[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Unable to load community items.");
        setItems([...(result.skills ?? []), ...(result.resumeBullets ?? [])]);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadingError(error instanceof Error ? error.message : "Unable to load community items.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    void loadItems();
    return () => controller.abort();
  }, []);

  const courseGroups = useMemo<CourseGroup[]>(() => {
    const groups = new Map<string, CourseGroup>();
    for (const item of items) {
      const group = groups.get(item.courseId) ?? {
        id: item.courseId,
        code: item.courseCode,
        title: item.courseTitle,
        canVote: item.canVote,
        items: [],
      };
      group.items.push(item);
      groups.set(item.courseId, group);
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: group.items.sort((left, right) =>
          right.upvotes - left.upvotes || popularity(right) - popularity(left) || left.name.localeCompare(right.name),
        ),
      }))
      .sort((left, right) => left.code.localeCompare(right.code));
  }, [items]);

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return courseGroups
      .filter((group) => !isSignedIn || !completedOnly || group.canVote)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (!query) return true;
          return [item.name, item.courseCode, item.courseTitle, item.evidence ?? "", item.targetRole ?? "", ...item.professors]
            .some((value) => value.toLowerCase().includes(query));
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [courseGroups, search, completedOnly, isSignedIn]);

  async function castVote(item: CommunityItem, desiredVote: 1 | -1) {
    if (!isSignedIn) {
      setVoteError("Sign in to vote on community items.");
      return;
    }
    if (!item.canVote) {
      setVoteError("You can vote only on courses you have completed.");
      return;
    }
    setVoteError("");
    setPendingVote(item.id);
    const vote = item.userVote === desiredVote ? null : desiredVote;
    const endpoint = item.kind === "skill"
      ? `/api/course-skills/${item.id}/vote`
      : `/api/resume-bullets/${item.id}/vote`;
    try {
      const response = await fetch(endpoint, {
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
      if (!response.ok) throw new Error(result.error ?? "Unable to save your vote.");
      setItems((current) => current.map((currentItem) => currentItem.id === item.id
        ? {
            ...currentItem,
            userVote: result.userVote ?? null,
            upvotes: result.upvotes ?? currentItem.upvotes,
            downvotes: result.downvotes ?? currentItem.downvotes,
          }
        : currentItem));
    } catch (error) {
      setVoteError(error instanceof Error ? error.message : "Unable to save your vote.");
    } finally {
      setPendingVote(null);
    }
  }

  function renderItem(item: CommunityItem, isFeatured = false) {
    const isExpanded = expandedItemIds.has(item.id);
    const score = popularity(item);
    return (
      <li className={`community-item${isFeatured ? " community-item-featured" : ""}`} key={item.id}>
        <div className="community-item-main">
          <div className="community-item-title">
            {isFeatured ? <span className="community-item-badge">Most upvoted</span> : null}
            <span className="community-item-kind">{item.kind === "skill" ? "Skill" : "Resume bullet"}</span>
            <strong>{item.name}</strong>
            {item.targetRole ? <span className="community-item-role">For {item.targetRole}</span> : null}
            {item.kind === "skill" ? (
              <button
                className="skill-details-toggle"
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setExpandedItemIds((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })}
              >
                {isExpanded ? "Hide evidence" : "Evidence"}
              </button>
            ) : null}
          </div>
          <div className="community-item-professor">
            <span className="community-column-label">Professor</span>
            {item.professors.length ? item.professors.join(", ") : "Not listed"}
          </div>
          <div className="community-item-voting">
            <span className="community-column-label">Community votes</span>
            <div className="skill-votes" aria-label={`Votes for ${item.name}`}>
              <button
                className={`vote-button${item.userVote === 1 ? " selected" : ""}`}
                type="button"
                aria-label={`Upvote ${item.name}`}
                aria-pressed={item.userVote === 1}
                disabled={!isSignedIn || !item.canVote || pendingVote === item.id}
                onClick={() => void castVote(item, 1)}
              >▲ {item.upvotes}</button>
              <button
                className={`vote-button${item.userVote === -1 ? " selected" : ""}`}
                type="button"
                aria-label={`Downvote ${item.name}`}
                aria-pressed={item.userVote === -1}
                disabled={!isSignedIn || !item.canVote || pendingVote === item.id}
                onClick={() => void castVote(item, -1)}
              >▼ {item.downvotes}</button>
            </div>
            <span className="community-vote-score">Net {score > 0 ? "+" : ""}{score}</span>
          </div>
        </div>
        {item.kind === "skill" && isExpanded ? (
          <div className="community-item-evidence">
            <span className="source-badge">{item.sourceType?.replaceAll("_", " ") ?? "Course skill"}</span>
            <p>{item.evidence || "No evidence provided."}</p>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <section className="skills-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">Peer-reviewed skills</p>
          <h1>Course skills</h1>
          <p className="skills-intro">
            Explore community-supported skills and resume bullets by course. Only students who mark a course completed can vote on its items.
          </p>
        </div>
        <span className="row-count">{visibleGroups.reduce((sum, group) => sum + group.items.length, 0)} items</span>
      </div>

      <div className="skills-filters">
        <label>
          <span>Search courses, skills, bullets, or professors</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all community items" />
        </label>
        {isSignedIn ? (
          <label className="completed-course-toggle">
            <span>{completedOnly ? "Courses I’ve completed" : "All courses"}</span>
            <input
              type="checkbox"
              checked={completedOnly}
              aria-label="Show only courses I’ve completed"
              onChange={(event) => setCompletedOnly(event.target.checked)}
            />
            <span className="completed-course-toggle-switch" aria-hidden="true" />
          </label>
        ) : null}
      </div>

      {voteError ? <div className="message error skills-error" role="alert">{voteError}</div> : null}
      {loadingError ? <div className="message error" role="alert">{loadingError}</div> : isLoading ? (
        <p className="message">Loading community items...</p>
      ) : visibleGroups.length === 0 ? (
        <p className="message">
          {items.length
            ? completedOnly && isSignedIn
              ? "No community items match these filters. Turn off the completed-courses toggle to browse all courses."
              : "No community items match these filters."
            : "No community items have been shared yet."}
        </p>
      ) : (
        <div className="community-course-list">
          {visibleGroups.map((group) => {
            const top = group.items[0];
            const skillCount = group.items.filter((item) => item.kind === "skill").length;
            const bulletCount = group.items.filter((item) => item.kind === "resume_bullet").length;
            const professors = Array.from(new Set(group.items.flatMap((item) => item.professors)));
            return (
              <details className="community-course" key={group.id}>
                <summary>
                  <span className="community-course-name">
                    <strong>{group.code}</strong>
                    <span>{group.title}</span>
                  </span>
                  <span className="community-course-counts">{skillCount} skills · {bulletCount} bullets</span>
                  <span className="community-course-professors">{professors.length ? professors.join(", ") : "Professor not listed"}</span>
                  <span className="community-course-top">
                    <span>{top.upvotes + top.downvotes ? "Most upvoted" : "Popular pick"}</span>
                    <strong>{top.upvotes + top.downvotes ? top.name : "Awaiting community votes"}</strong>
                    <small>{top.upvotes + top.downvotes ? `${top.upvotes} upvotes · ${top.professors.length ? top.professors.join(", ") : "professor not listed"}` : "Be the first to rate an item"}</small>
                  </span>
                  <span className="community-course-toggle" aria-hidden="true">+</span>
                </summary>
                <div className="community-course-content">
                  <div className="community-list-labels" aria-hidden="true">
                    <span>Community item</span><span>Professor</span><span>Votes</span>
                  </div>
                  <ol className="community-items">
                    {group.items.map((item, index) => renderItem(item, index === 0 && item.upvotes + item.downvotes > 0))}
                  </ol>
                  {!group.canVote ? <p className="community-vote-hint">Complete this course and mark it as completed during analysis to vote on its items.</p> : null}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
