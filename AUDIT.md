# GESTIONALE MORELLI - Code Audit Report

**Date:** June 2026  
**Status:** Production Ready (with minor refinements)  
**Priority:** MEDIUM — Code quality & scalability

---

## EXECUTIVE SUMMARY

Gestionale is a **single-tenant compliance management system** (training, medical surveillance, DPI, shifts) for Morelli construction. Built on Next.js 16 + Supabase.

**Strengths:**
- ✅ Solid module-based RBAC (formazione, sorveglianza, turni, dpi, mezzi_attrezzature, lavoratori, gestione)
- ✅ RLS policies correctly implemented on all 39 tables
- ✅ Manager-code filtering for scope-based access (intentional)
- ✅ No critical security vulnerabilities found
- ✅ Comprehensive API routes for all modules

**Weaknesses:**
- ⚠️ 60+ route handlers could be consolidated via shared patterns
- ⚠️ Inconsistent error handling across API routes
- ⚠️ Missing rate limiting on import/export operations
- ⚠️ PDF import (sorveglianza) not fully validated
- ⚠️ No caching strategy for expensive queries (training matrix, schedule generation)

---

## 🟡 MEDIUM PRIORITY ISSUES

### 1. **API Route Pattern Duplication** (CODE SMELL)

**Problem:**
- 60+ API routes follow similar patterns but no shared utilities
- Each route reimplements: auth check → access check → query → response

**Examples:**
```typescript
// src/app/api/formazione/corsi/route.ts
// src/app/api/formazione/esclusioni/route.ts
// src/app/api/formazione/matrice/route.ts
// src/app/api/turni/shifts/route.ts
// ... all repeat same validation pattern
```

**Recommendation:**
Create middleware factory:
```typescript
// src/lib/api/with-module-access.ts
export function withModuleAccess(module: string) {
  return (handler: RouteHandler) => {
    return async (req, ctx) => {
      const profile = await getProfile();
      if (!hasModuleAccess(profile, module)) {
        return new Response('Forbidden', { status: 403 });
      }
      return handler(req, ctx);
    };
  };
}

// Usage:
export const GET = withModuleAccess('formazione')(async (req) => {
  // handler logic
});
```

**Timeline:** 2 days  
**Priority:** Medium (improves maintainability)

---

### 2. **Import/Export Operations Missing Validation** (RELIABILITY)

**Files:**
- `src/app/api/formazione/import/route.ts`
- `src/app/api/sorveglianza_sanitaria/import-pdf/route.ts`
- `src/app/api/turni/export/route.ts`

**Issues:**
- No file size limits
- No virus/malware scanning
- PDF import (sorveglianza) trusts pdfjs-dist output without validation
- Excel import (training) doesn't validate before DB insert

**Recommendations:**
```typescript
// Add to import routes
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
if (req.size > MAX_FILE_SIZE) {
  return new Response('File too large', { status: 413 });
}

// Validate extracted data before insert
const schema = z.object({
  matricola: z.string().length(10),
  course_id: z.number().min(1),
  completion_date: z.date().optional(),
});

const validatedRows = rows.map(r => schema.parse(r));
```

**Timeline:** 2 days  
**Priority:** Medium (prevents bad data from entering DB)

---

### 3. **No Caching for Expensive Queries** (PERFORMANCE)

**Expensive Operations:**
- Training matrix generation (formazione/matrice) — scans 10k+ rows
- Schedule generation (turni/generate) — complex calculations
- Medical surveillance matrix (sorveglianza/matrice) — cross-employee lookups

**Current Implementation:**
```typescript
// src/app/api/formazione/matrice/route.ts
export const GET = async () => {
  const matrix = await db.trainingMatrix.fetch(); // No cache
  return Response.json(matrix);
};
```

**Recommendation:**
Implement caching layer:
```typescript
// src/lib/server-cache.ts (already exists, extend it)
export const trainingMatrixCache = new Cache({
  ttl: 3600, // 1 hour
  key: `training-matrix-${userId}`,
});

// Usage:
const matrix = await trainingMatrixCache.get(
  () => db.trainingMatrix.fetch(),
  { userId: ctx.user.id }
);
```

**Timeline:** 1-2 days  
**Priority:** Medium (improves response times for large datasets)

---

### 4. **Error Handling Inconsistent** (RELIABILITY)

**Problem:**
- Some routes return `{ error: "..." }`, others throw
- Some log errors, others silently fail
- HTTP status codes sometimes wrong

**Examples:**
```typescript
// Good: formazione/esclusioni/route.ts
try {
  // logic
} catch (err) {
  console.error(err);
  return new Response(JSON.stringify({ error: err.message }), { status: 500 });
}

// Bad: turni/generate/route.ts
if (!user) return new Response('Unauthorized'); // Missing status code
```

**Recommendation:**
Create error handler middleware:
```typescript
// src/lib/api/error-handler.ts
export function handleError(error: Error, context?: string) {
  const isDev = process.env.NODE_ENV === 'development';
  
  console.error(`[${context}] ${error.message}`, error);
  
  if (error instanceof ValidationError) {
    return new Response(
      JSON.stringify({ error: error.message, code: 'VALIDATION_ERROR' }),
      { status: 400 }
    );
  }
  
  if (error instanceof AuthError) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401 }
    );
  }
  
  return new Response(
    JSON.stringify({ 
      error: 'Internal Server Error',
      ...(isDev && { details: error.message })
    }),
    { status: 500 }
  );
}
```

**Timeline:** 1-2 days  
**Priority:** Medium (improves debugging)

---

### 5. **Rate Limiting Missing on Bulk Operations** (SECURITY)

**At-Risk Routes:**
- POST `/api/formazione/import` — could be abused to DoS
- POST `/api/turni/generate` — heavy computation
- POST `/api/sorveglianza_sanitaria/import-pdf` — file processing

**Recommendation:**
```typescript
// src/lib/api/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';

const importRL = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '1 h'), // 5 imports per hour
});

// Usage in import route:
const { success } = await importRL.limit(`import-${userId}`);
if (!success) {
  return new Response('Rate limit exceeded', { status: 429 });
}
```

**Timeline:** 1 day (if using Upstash or similar service)  
**Priority:** Medium (prevents abuse)

---

## 🟢 LOW PRIORITY / NICE-TO-HAVE

### 6. **TypeScript Strictness**

**Issue:** Some files use `any` type.

**Files with `any`:**
- `src/lib/excel.ts` — data processing uses `any`
- `src/app/api/sorveglianza_sanitaria/import-pdf/route.ts` — PDF parsing output

**Recommendation:** Tighten types, use `unknown` → validate → use.

**Timeline:** 1 day  
**Priority:** Low

---

### 7. **Unused Dependencies**

**Check:**
- `pdfjs-dist` — only used for sorveglianza PDF import. Consider using `pdf-lib` instead (lighter).
- `xlsx-js-style` — includes style support but only basic reading used.
- `jszip` — not found in codebase, check if needed.

**Timeline:** 0.5 day  
**Priority:** Low (reduces bundle size)

---

### 8. **Test Coverage**

**Current:** No test files found.  
**Recommendation:** Add integration tests for critical paths:
```typescript
// src/tests/formazione-import.test.ts
describe('Training Import', () => {
  test('should import valid training records', async () => {
    // test
  });
  
  test('should reject invalid matricola', async () => {
    // test
  });
});
```

**Timeline:** 3-5 days (if prioritized)  
**Priority:** Low

---

## DATABASE & RLS OBSERVATIONS

**Good:**
- ✅ 39 tables with RLS enabled
- ✅ Module-based permission model (correct)
- ✅ Manager-code filtering (intentional, for role-based scope)
- ✅ Comprehensive migrations with clear naming

**Good Practices:**
- Employee data public (employees table has no manager filter) — correct
- Module access checked at DB level (RLS policies)
- Access scope functions well-designed

**Minor Issues:**
- `internal.can_access_*()` functions could have better caching (currently executed per query)
- `import_run_changes` table grows indefinitely (no retention policy)

---

## DEPLOYMENT READINESS

- [x] RLS policies verified (no critical issues)
- [x] Authentication working (Next.js SSR + Supabase)
- [ ] Add API rate limiting (recommended before scaling)
- [ ] Add file size validation on import routes
- [ ] Consolidate API route patterns
- [ ] Improve error handling consistency
- [ ] Add caching for expensive queries
- [ ] Enable TypeScript strict mode
- [ ] Audit unused dependencies

---

## ARCHITECTURE OVERVIEW

```
Gestionale (Single-tenant compliance)
├── Modules (via RLS policies + module_permissions table)
│   ├── Formazione (training courses)
│   ├── Sorveglianza Sanitaria (medical surveillance)
│   ├── DPI (protective equipment)
│   ├── Turni (scheduling)
│   ├── Mezzi & Attrezzature (fleet assets)
│   ├── Lavoratori (employees, public)
│   └── Gestione (admin, user management)
├── Access Control
│   ├── Module-based (has_module_access())
│   ├── Manager-scoped (can_access_employee via manager_code)
│   └── Role-based (admin / viewer / manager)
├── Import/Export
│   ├── Excel (formazione, sorveglianza, turni)
│   ├── PDF (sorveglianza medical records)
│   └── Undo capability (import_run_changes tracking)
└── Backend (Next.js API routes → Supabase RLS)
```

---

## SCALABILITY ASSESSMENT

**Current:** Single company (Morelli)  
**Future:** Could be multi-tenant but would require:
1. Add `company_id` column to all tables
2. Change RLS from single-tenant to multi-tenant pattern
3. Update module_permissions to filter by company

**Effort:** 3-4 days if needed.

---

## TIMELINE ESTIMATE

| Task | Days | Blocking |
|------|------|----------|
| Consolidate API routes (#1) | 2 | NO |
| Add validation to imports (#2) | 2 | NO |
| Implement caching (#3) | 1-2 | NO |
| Fix error handling (#4) | 1-2 | NO |
| Add rate limiting (#5) | 1 | NO |
| Tighten TypeScript (#6) | 1 | NO |
| Audit dependencies (#7) | 0.5 | NO |
| **Total** | **8-10 days** | |

**None blocking.** Can deploy as-is; improvements are quality-of-life.

---

## NEXT STEP

When ready:
1. Create `src/lib/api/with-module-access.ts` — centralize auth checks
2. Create `src/lib/api/error-handler.ts` — standardize error responses
3. Refactor 5-10 route handlers to use new patterns
4. Add rate limiting to import routes
5. Test with 10k+ employee records to validate caching strategy
