-- Add session fields to training_plan_drafts
ALTER TABLE public.training_plan_drafts
ADD COLUMN course_type TEXT, -- 'e-learning', 'fad_sincrona', 'presenza'
ADD COLUMN fornitore TEXT,
ADD COLUMN location TEXT,
ADD COLUMN date1 DATE,
ADD COLUMN time1_start TIME,
ADD COLUMN date2 DATE,
ADD COLUMN time2_start TIME;

-- Create training_course_hours table (populated when user provides ore_corsi_da_compilare.xlsx)
CREATE TABLE IF NOT EXISTS public.training_course_hours (
    id BIGSERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
    hours_elearning NUMERIC(5, 2),
    hours_fad_sincrona NUMERIC(5, 2),
    hours_aula NUMERIC(5, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(course_id)
);

ALTER TABLE public.training_course_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.training_course_hours;
CREATE POLICY "Enable read access for authenticated users"
ON public.training_course_hours FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.training_course_hours;
CREATE POLICY "Enable all access for authenticated users"
ON public.training_course_hours FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER training_course_hours_set_updated_at
BEFORE UPDATE ON public.training_course_hours
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
