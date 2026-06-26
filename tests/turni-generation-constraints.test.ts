import assert from "node:assert/strict";
import test from "node:test";

type Assignment = {
  employee_id: number;
  sub_site_id: number | null;
  start_date: string;
  end_date: string | null;
};

type Employee = {
  id: number;
  status: string;
};

type Freeze = {
  employee_id: number;
  freeze_status: string;
  start_date: string;
  end_date: string | null;
};

// Extracted local logic simulation to test the filtering correctness of the generator
function filterActiveAndUnfrozenAssignments(args: {
  assignments: Assignment[];
  employees: Employee[];
  freezes: Freeze[];
  dayIso: string;
}) {
  const { assignments, employees, freezes, dayIso } = args;

  const activeEmployeeIds = new Set(
    employees.filter((emp) => emp.status === "attivo").map((emp) => emp.id)
  );

  return assignments.filter((a) => {
    // 1. Must be active status
    if (!activeEmployeeIds.has(a.employee_id)) return false;
    // 2. Dates must match
    if (a.start_date > dayIso) return false;
    if (a.end_date && a.end_date < dayIso) return false;

    // 3. Must not be frozen on dayIso
    const isFrozen = freezes.some((f) => {
      if (f.employee_id !== a.employee_id) return false;
      if (f.start_date > dayIso) return false;
      if (f.end_date && f.end_date < dayIso) return false;
      return true;
    });
    if (isFrozen) return false;

    return true;
  });
}

test("filterActiveAndUnfrozenAssignments: matches only active and unfrozen employees", () => {
  const employees: Employee[] = [
    { id: 1, status: "attivo" },
    { id: 2, status: "dimesso" },
    { id: 3, status: "attivo" },
  ];

  const assignments: Assignment[] = [
    { employee_id: 1, sub_site_id: null, start_date: "2026-06-01", end_date: null },
    { employee_id: 2, sub_site_id: null, start_date: "2026-06-01", end_date: null },
    { employee_id: 3, sub_site_id: null, start_date: "2026-06-01", end_date: null },
  ];

  const freezes: Freeze[] = [
    { employee_id: 3, freeze_status: "maternita", start_date: "2026-06-10", end_date: "2026-06-20" },
  ];

  // Test on 2026-06-05: worker 1 & 3 should be active, worker 2 skipped (dimesso)
  const resultJune5 = filterActiveAndUnfrozenAssignments({
    assignments,
    employees,
    freezes,
    dayIso: "2026-06-05",
  });
  assert.equal(resultJune5.length, 2);
  assert.ok(resultJune5.some((a) => a.employee_id === 1));
  assert.ok(resultJune5.some((a) => a.employee_id === 3));

  // Test on 2026-06-15: worker 3 is frozen (maternita), should be filtered out. Only worker 1 remains.
  const resultJune15 = filterActiveAndUnfrozenAssignments({
    assignments,
    employees,
    freezes,
    dayIso: "2026-06-15",
  });
  assert.equal(resultJune15.length, 1);
  assert.equal(resultJune15[0]?.employee_id, 1);
});
