CREATE TABLE public.course_skill_votes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_skill_id uuid NOT NULL,
  user_id uuid NOT NULL,
  vote smallint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT course_skill_votes_pkey PRIMARY KEY (id),
  CONSTRAINT course_skill_votes_skill_user_key UNIQUE (course_skill_id, user_id),
  CONSTRAINT course_skill_votes_vote_check CHECK (vote IN (-1, 1)),
  CONSTRAINT course_skill_votes_course_skill_id_fkey
    FOREIGN KEY (course_skill_id) REFERENCES public.course_skills (id) ON DELETE CASCADE,
  CONSTRAINT course_skill_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX course_skill_votes_skill_idx
  ON public.course_skill_votes (course_skill_id);

ALTER TABLE public.course_skill_votes ENABLE ROW LEVEL SECURITY;

CREATE VIEW public.course_skill_vote_totals AS
SELECT
  course_skill_id,
  count(*) FILTER (WHERE vote = 1)::integer AS upvotes,
  count(*) FILTER (WHERE vote = -1)::integer AS downvotes
FROM public.course_skill_votes
GROUP BY course_skill_id;

REVOKE ALL ON public.course_skill_vote_totals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_skill_vote_totals TO service_role;
