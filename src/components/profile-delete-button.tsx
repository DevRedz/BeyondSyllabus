"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  kind: "item" | "course";
  id: string;
  label: string;
  itemType?: "skill" | "resume_bullet";
  isPublic?: boolean;
  skillCount?: number;
  bulletCount?: number;
  sectionCount?: number;
};

export default function ProfileDeleteButton(props: Props) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const confirmation = props.kind === "course"
      ? `Delete ${props.label} from your profile? This will also delete ${props.skillCount ?? 0} saved skills, ${props.bulletCount ?? 0} saved resume bullets, and ${props.sectionCount ?? 0} term/section records. Your votes for this course will be removed, and your public resume bullets will disappear from the community. Shared course catalog skills stay available to other users. This cannot be undone.`
      : props.itemType === "skill"
        ? `Delete this saved skill from your profile?${props.isPublic ? " The shared course skill may still appear in the community catalog." : ""} This cannot be undone.`
        : `Delete this saved resume bullet from your profile?${props.isPublic ? " Its public community item and votes will also be removed." : ""} This cannot be undone.`;
    if (!window.confirm(confirmation)) return;

    setError("");
    setIsDeleting(true);
    try {
      const endpoint = props.kind === "course"
        ? `/api/profile/courses/${props.id}`
        : `/api/profile/items/${props.id}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete this profile item.");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this profile item.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <span className="profile-delete-control">
      <button className="dashboard-delete-button" type="button" disabled={isDeleting} onClick={() => void remove()}>
        {isDeleting ? "Deleting…" : "Delete"}
      </button>
      {error ? <span className="profile-delete-error" role="alert">{error}</span> : null}
    </span>
  );
}
