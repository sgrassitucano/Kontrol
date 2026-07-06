-- Staging table for medical surveillance imports
CREATE TABLE IF NOT EXISTS public.medical_surveillance_import_staging (
    id BIGSERIAL PRIMARY KEY,
    import_run_id UUID NOT NULL,
    row_number INTEGER,
    source_data JSONB, -- raw row from file
    normalized_data JSONB, -- auto-normalized (uppercase, date formats, etc.)
    validation_errors JSONB[], -- array of validation error objects
    conflict_type TEXT, -- 'duplicate', 'ambiguous', 'none'
    conflict_details JSONB, -- details of conflict
    status TEXT DEFAULT 'pending', -- pending | resolved | approved | rejected
    resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.medical_surveillance_import_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.medical_surveillance_import_staging;
CREATE POLICY "Enable all access for authenticated users"
ON public.medical_surveillance_import_staging FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Import run tracking (separate from general import_runs)
CREATE TABLE IF NOT EXISTS public.medical_surveillance_import_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT, -- 'sorveglianza_staging'
    file_name TEXT,
    import_method TEXT, -- 'direct' | 'staging'
    total_rows INTEGER,
    staging_rows INTEGER,
    approved_rows INTEGER,
    error_rows INTEGER,
    column_mapping JSONB, -- { "colonna_A": "matricola", "colonna_B": "data_nascita", ... }
    status TEXT DEFAULT 'staging', -- staging | staged | completed | failed
    imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.medical_surveillance_import_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.medical_surveillance_import_runs;
CREATE POLICY "Enable all access for authenticated users"
ON public.medical_surveillance_import_runs FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER medical_surveillance_import_runs_set_updated_at
BEFORE UPDATE ON public.medical_surveillance_import_runs
FOR EACH ROW
EXECUTE FUNCTION internal.set_updated_at();
