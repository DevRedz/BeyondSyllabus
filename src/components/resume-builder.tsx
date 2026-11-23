"use client";

import { useRef, useState, type DragEvent } from "react";

export type ResumeSection = "skills" | "projects";

export type ResumeItem = {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  itemType: "skill" | "resume_bullet";
  text: string;
  category: string | null;
  resumeSection: ResumeSection | null;
  resumePosition: number | null;
  createdAt: string;
};

type ResumeBuilderProps = {
  items: ResumeItem[];
  isSignedIn: boolean;
  displayName: string;
  email: string;
  authError: boolean;
  loadError: string;
};

function orderedItems(items: ResumeItem[], section: ResumeSection) {
  return items
    .filter((item) => item.resumeSection === section)
    .sort((left, right) => (left.resumePosition ?? 0) - (right.resumePosition ?? 0));
}

function itemSection(item: ResumeItem): ResumeSection {
  return item.itemType === "skill" ? "skills" : "projects";
}

function projectGroups(items: ResumeItem[]) {
  const groups = new Map<string, { courseCode: string; courseTitle: string; items: ResumeItem[] }>();
  for (const item of items) {
    const group = groups.get(item.courseId) ?? {
      courseCode: item.courseCode,
      courseTitle: item.courseTitle,
      items: [],
    };
    group.items.push(item);
    groups.set(item.courseId, group);
  }
  return Array.from(groups.values());
}

export default function ResumeBuilder({
  items: initialItems,
  isSignedIn,
  displayName,
  email,
  authError,
  loadError,
}: ResumeBuilderProps) {
  const [items, setItems] = useState(initialItems);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ResumeSection | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const latestSnapshot = useRef(initialItems);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const libraryItems = items.filter((item) => item.resumeSection === null);
  const skills = orderedItems(items, "skills");
  const projects = orderedItems(items, "projects");

  function persist(nextItems: ResumeItem[]) {
    latestSnapshot.current = nextItems;
    setSaveState("saving");
    setSaveMessage("Saving your layout…");
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch("/api/resume/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: nextItems.map((item) => ({
              id: item.id,
              section: item.resumeSection,
              position: item.resumePosition,
            })),
          }),
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Your resume could not be saved.");
        if (latestSnapshot.current === nextItems) {
          setSaveState("saved");
          setSaveMessage("Layout saved");
        }
      })
      .catch((error: unknown) => {
        if (latestSnapshot.current === nextItems) {
          setSaveState("error");
          setSaveMessage(error instanceof Error ? error.message : "Your resume could not be saved.");
        }
      });
  }

  function moveItem(id: string, section: ResumeSection | null, beforeId?: string) {
    const moving = items.find((item) => item.id === id);
    if (!moving) return;
    if (section && itemSection(moving) !== section) {
      setActionMessage(
        moving.itemType === "skill"
          ? "Skills belong in the Skills section."
          : "Resume bullets belong in Projects.",
      );
      return;
    }

    const nextOrder: Record<ResumeSection, ResumeItem[]> = {
      skills: orderedItems(items, "skills").filter((item) => item.id !== id),
      projects: orderedItems(items, "projects").filter((item) => item.id !== id),
    };
    if (section) {
      const destination = nextOrder[section];
      const beforeIndex = beforeId
        ? destination.findIndex((item) => item.id === beforeId)
        : -1;
      const insertAt = beforeIndex < 0 ? destination.length : beforeIndex;
      destination.splice(insertAt, 0, moving);
    }

    const positionById = new Map<string, { section: ResumeSection; position: number }>();
    for (const target of ["skills", "projects"] as const) {
      nextOrder[target].forEach((item, position) => {
        positionById.set(item.id, { section: target, position });
      });
    }

    const nextItems = items.map((item) => {
      const placement = positionById.get(item.id);
      return placement
        ? { ...item, resumeSection: placement.section, resumePosition: placement.position }
        : { ...item, resumeSection: null, resumePosition: null };
    });
    setItems(nextItems);
    setActionMessage("");
    persist(nextItems);
  }

  function handleDrop(event: DragEvent, section: ResumeSection, beforeId?: string) {
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    if (id && id !== beforeId) moveItem(id, section, beforeId);
    setDraggingId(null);
    setDropTarget(null);
  }

  function renderBlock(item: ResumeItem, section: ResumeSection, index: number) {
    const sectionItems = orderedItems(items, section);
    return (
      <article
        className={`resume-block resume-block-${item.itemType}${draggingId === item.id ? " is-dragging" : ""}`}
        key={item.id}
        draggable
        tabIndex={0}
        title={item.itemType === "skill" ? `From ${item.courseCode} · ${item.courseTitle}` : undefined}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          setDraggingId(item.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDropTarget(null);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, section, item.id)}
      >
        <span className="resume-block-grip" aria-hidden="true">⠿</span>
        <div className="resume-block-copy">
          <strong>{item.text}</strong>
          {section === "skills" && item.category ? (
            <span className="resume-block-category">{item.category}</span>
          ) : null}
        </div>
        <button
          className="resume-block-move"
          type="button"
          disabled={index === 0}
          onClick={() => moveItem(item.id, section, sectionItems[index - 1]?.id)}
          aria-label={`Move ${item.itemType === "skill" ? "skill" : "bullet point"} up`}
          title="Move up"
        >
          ↑
        </button>
        <button
          className="resume-block-move"
          type="button"
          disabled={index >= sectionItems.length - 1}
          onClick={() => moveItem(item.id, section, sectionItems[index + 2]?.id)}
          aria-label={`Move ${item.itemType === "skill" ? "skill" : "bullet point"} down`}
          title="Move down"
        >
          ↓
        </button>
        <button
          className="resume-block-remove"
          type="button"
          onClick={() => moveItem(item.id, null)}
          aria-label={`Remove ${item.itemType === "skill" ? "skill" : "bullet point"} from resume`}
          title="Return to saved items"
        >
          ×
        </button>
        <span className="resume-block-order">{index + 1}</span>
      </article>
    );
  }

  function renderLibraryItem(item: ResumeItem) {
    const destination = itemSection(item);
    return (
      <article
        className={`resume-library-block resume-library-${item.itemType}${draggingId === item.id ? " is-dragging" : ""}`}
        key={item.id}
        draggable
        tabIndex={0}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          setDraggingId(item.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDropTarget(null);
        }}
      >
        <span className="resume-library-kind">{item.itemType === "skill" ? "Skill" : "Project bullet"}</span>
        <strong>{item.text}</strong>
        <span className="resume-library-source">{item.courseCode} · {item.courseTitle}</span>
        <button type="button" onClick={() => moveItem(item.id, destination)}>
          Add to {destination === "skills" ? "Skills" : "Projects"}
        </button>
      </article>
    );
  }

  const projectCourseGroups = projectGroups(projects);

  return (
    <section className="resume-builder-page">
      <div className="resume-builder-heading">
        <div>
          <p className="eyebrow">Your work, arranged your way</p>
          <h1>Resume</h1>
          <p>Drag saved blocks onto the page. Move them to change the order, or use the add buttons.</p>
        </div>
        <div className="resume-heading-actions">
          <span className={`resume-save-status is-${saveState}`} role="status" aria-live="polite">
            {saveMessage || (items.length ? `${items.length - libraryItems.length} placed` : "No saved blocks yet")}
          </span>
          <button className="resume-print-button" type="button" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      {authError ? (
        <div className="message error" role="alert">Google sign-in could not be completed. Please try again.</div>
      ) : null}
      {loadError ? <div className="message error" role="alert">{loadError}</div> : null}
      {!isSignedIn ? (
        <div className="message resume-signin-message" role="status">
          Sign in to see your saved skills and resume bullets here.
        </div>
      ) : null}

      <div className="resume-workspace">
        <aside className="resume-library" aria-labelledby="resume-library-heading">
          <div className="resume-panel-heading">
            <div>
              <p className="eyebrow">Saved blocks</p>
              <h2 id="resume-library-heading">Your library</h2>
            </div>
            <span>{libraryItems.length}</span>
          </div>
          <p className="resume-library-help">Drag a block onto the matching section, or add it with a button.</p>
          {libraryItems.length ? (
            <div className="resume-library-list">{libraryItems.map(renderLibraryItem)}</div>
          ) : (
            <div className="resume-library-empty">
              {items.length ? "All your saved blocks are on the resume." : "Save skills and bullets from Course skills or Syllabus review to start building."}
            </div>
          )}
          {actionMessage ? <p className="resume-action-message" role="status">{actionMessage}</p> : null}
        </aside>

        <div className="resume-canvas-wrap">
          <div className="resume-canvas-toolbar">
            <span>Resume preview</span>
            <span>Changes save automatically</span>
          </div>
          <div className="resume-paper">
            <header className="resume-paper-header">
              <p className="resume-paper-label">Resume</p>
              <h2>{displayName}</h2>
              {email ? <p>{email}</p> : <p className="resume-contact-placeholder">Your email</p>}
            </header>

            <section
              className={`resume-drop-section resume-drop-skills${dropTarget === "skills" ? " is-drop-target" : ""}`}
              aria-labelledby="resume-skills-heading"
              onDragOver={(event) => {
                event.preventDefault();
                setDropTarget("skills");
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={(event) => handleDrop(event, "skills")}
            >
              <div className="resume-section-title-row">
                <h3 id="resume-skills-heading">Skills</h3>
                <span>{skills.length ? `${skills.length} selected` : "Add skills"}</span>
              </div>
              {skills.length ? (
                <div className="resume-placed-list">{skills.map((item, index) => renderBlock(item, "skills", index))}</div>
              ) : (
                <div className="resume-drop-empty">Drop skill blocks here to build this section.</div>
              )}
            </section>

            <section
              className={`resume-drop-section resume-drop-projects${dropTarget === "projects" ? " is-drop-target" : ""}`}
              aria-labelledby="resume-projects-heading"
              onDragOver={(event) => {
                event.preventDefault();
                setDropTarget("projects");
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={(event) => handleDrop(event, "projects")}
            >
              <div className="resume-section-title-row">
                <h3 id="resume-projects-heading">Projects</h3>
                <span>{projects.length ? `${projects.length} bullets` : "Add project bullets"}</span>
              </div>
              {projects.length ? (
                <div className="resume-project-groups">
                  {projectCourseGroups.map((group) => (
                    <div className="resume-project-group" key={group.items[0]?.courseId}>
                      <h4>{group.courseCode} · {group.courseTitle}</h4>
                      {group.items.map((item) => {
                        const index = projects.findIndex((project) => project.id === item.id);
                        return renderBlock(item, "projects", index);
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="resume-drop-empty">Drop resume bullet blocks here to show course projects.</div>
              )}
            </section>

            <footer className="resume-paper-footer">Built with Beyond Syllabus</footer>
          </div>
        </div>
      </div>
    </section>
  );
}
