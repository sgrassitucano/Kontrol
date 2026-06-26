import { z } from "zod";

export const medicalPatchSchema = z.object({
  employeeId: z.number().int().positive("L'ID dipendente deve essere valido."),
  provider: z.string().trim().nullable().optional(),
  planned: z.boolean().optional(),
  exclusionEnabled: z.boolean().optional(),
  exclusionNote: z.string().trim().nullable().optional(),
  overrideEnabled: z.boolean().optional(),
  overrideRequiresVisit: z.boolean().optional(),
  overrideNote: z.string().trim().nullable().optional(),
});

export const medicalRecordSchema = z.object({
  employee_id: z.number().int().positive(),
  provider: z.string().trim().nullable().optional(),
  requires_visit: z.boolean().default(true),
  is_planned: z.boolean().default(false),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (atteso YYYY-MM-DD).").nullable().optional(),
  limitations: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

export const pdfImportUpdateItemSchema = z.object({
  page: z.number().int().positive(),
  taxCode: z.string().trim().toUpperCase(),
  nextDueDate: z.string().trim().nullable().optional(),
  limitations: z.string().trim().nullable().optional(),
  applyDueDate: z.boolean().default(false),
  applyLimitations: z.boolean().default(false),
});

export const pdfImportUpdatesSchema = z.array(pdfImportUpdateItemSchema);
