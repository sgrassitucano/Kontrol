import { z } from "zod";

export const courseSchema = z.object({
  code: z.string().trim().min(1, "Il codice del corso è obbligatorio."),
  title: z.string().trim().min(1, "Il titolo del corso è obbligatorio."),
  validity_years: z.number().int().positive().nullable().optional(),
  is_unlimited: z.boolean().default(false),
});

export const employeeExclusionSchema = z.object({
  kind: z.literal("employee"),
  employeeId: z.number().int().positive("L'ID dipendente deve essere valido."),
  enabled: z.boolean(),
  note: z.string().trim().default(""),
});

export const courseExclusionSchema = z.object({
  kind: z.literal("course"),
  employeeId: z.number().int().positive("L'ID dipendente deve essere valido."),
  courseId: z.number().int().positive().optional().nullable(),
  courseCode: z.string().trim().optional().nullable(),
  enabled: z.boolean(),
  note: z.string().trim().default(""),
}).refine(
  (data) => data.courseId !== undefined || (data.courseCode !== undefined && data.courseCode !== ""),
  {
    message: "È necessario fornire l'ID o il codice del corso.",
    path: ["courseId"],
  }
);

export const exclusionRequestSchema = z.discriminatedUnion("kind", [
  employeeExclusionSchema,
  courseExclusionSchema,
]);

export const deleteExclusionSchema = z.object({
  kind: z.literal("course"),
  employeeId: z.number().int().positive(),
  courseId: z.number().int().positive(),
});

export const trainingRecordSchema = z.object({
  employee_id: z.number().int().positive(),
  course_id: z.number().int().positive(),
  completion_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (atteso YYYY-MM-DD).").nullable(),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (atteso YYYY-MM-DD).").nullable(),
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (atteso YYYY-MM-DD).").nullable(),
  manual_state: z.enum(["programmato", "escluso"]).nullable(),
  note: z.string().nullable(),
});
