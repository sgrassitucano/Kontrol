create or replace function internal.can_access_employee(
  employee_responsible_code text,
  employee_referral text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when internal.current_user_is_active() = false then false
    when internal.current_user_role() in ('admin', 'viewer') then true
    when internal.has_module_access('gestione') then true
    else case
      when coalesce(nullif(internal.current_manager_code(), ''), '') = '' then true
      else (
        employee_responsible_code = internal.current_manager_code()
        or employee_referral = internal.current_manager_code()
      )
    end
  end;
$$;

create or replace function internal.can_access_site(target_site_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when internal.current_user_is_active() = false then false
    when internal.current_user_role() in ('admin', 'viewer') then true
    when internal.has_module_access('gestione') then true
    else case
      when coalesce(nullif(internal.current_manager_code(), ''), '') = '' then true
      else exists (
        select 1
        from public.employees e
        where e.site_id = target_site_id
          and internal.can_access_employee(e.responsible_code, e.referral)
      )
    end
  end;
$$;

create or replace function internal.can_access_sub_site(target_sub_site_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when internal.current_user_is_active() = false then false
    when internal.current_user_role() in ('admin', 'viewer') then true
    when internal.has_module_access('gestione') then true
    else case
      when coalesce(nullif(internal.current_manager_code(), ''), '') = '' then true
      else exists (
        select 1
        from public.employees e
        where e.sub_site_id = target_sub_site_id
          and internal.can_access_employee(e.responsible_code, e.referral)
      )
    end
  end;
$$;
