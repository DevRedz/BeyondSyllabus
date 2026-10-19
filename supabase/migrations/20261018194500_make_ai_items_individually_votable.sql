ALTER TABLE public.ai_generations
  ADD COLUMN item_type text NOT NULL DEFAULT 'resume_bullet'
    CHECK (item_type IN ('skill', 'resume_bullet')),
  ADD COLUMN generated_text text,
  ADD COLUMN category text,
  ADD COLUMN evidence text;

CREATE INDEX ai_generations_public_items_idx
  ON public.ai_generations (is_public, item_type, created_at DESC);

CREATE UNIQUE INDEX votes_one_vote_per_user_per_item_idx
  ON public.votes (user_id, generation_id);
