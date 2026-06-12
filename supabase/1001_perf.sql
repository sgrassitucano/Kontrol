create index if not exists employee_freeze_periods_employee_id_dates_idx
  on public.employee_freeze_periods (employee_id, start_date, end_date);

create index if not exists employees_status_last_name_first_name_id_idx
  on public.employees (status, last_name, first_name, id);
