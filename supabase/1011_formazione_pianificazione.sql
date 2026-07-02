CREATE TABLE IF NOT EXISTS public.training_plan_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id INTEGER NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
    provider TEXT,
    mode TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    UNIQUE(employee_id, course_id)
);

ALTER TABLE public.training_plan_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.training_plan_drafts;
CREATE POLICY "Enable read access for authenticated users" 
ON public.training_plan_drafts FOR SELECT 
TO authenticated 
USING (true);

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.training_plan_drafts;
CREATE POLICY "Enable all access for authenticated users" 
ON public.training_plan_drafts FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);
