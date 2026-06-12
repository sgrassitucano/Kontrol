alter table public.fleet_assets enable row level security;
alter table public.fleet_asset_obligations enable row level security;
alter table public.fleet_obligation_events enable row level security;
alter table public.fleet_asset_assignments enable row level security;

drop policy if exists "fleet_assets_read" on public.fleet_assets;
drop policy if exists "fleet_assets_write" on public.fleet_assets;
drop policy if exists "fleet_assets_insert" on public.fleet_assets;
drop policy if exists "fleet_assets_update" on public.fleet_assets;
drop policy if exists "fleet_assets_delete_management_only" on public.fleet_assets;

create policy "fleet_assets_read"
  on public.fleet_assets
  for select
  using (
    (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'))
    and (site_id is null or public.can_access_site(site_id))
    and (sub_site_id is null or public.can_access_sub_site(sub_site_id))
  );

create policy "fleet_assets_insert"
  on public.fleet_assets
  for insert
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and (site_id is null or public.can_access_site(site_id))
    and (sub_site_id is null or public.can_access_sub_site(sub_site_id))
  );

create policy "fleet_assets_update"
  on public.fleet_assets
  for update
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and (site_id is null or public.can_access_site(site_id))
    and (sub_site_id is null or public.can_access_sub_site(sub_site_id))
  )
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and (site_id is null or public.can_access_site(site_id))
    and (sub_site_id is null or public.can_access_sub_site(sub_site_id))
  );

create policy "fleet_assets_delete_management_only"
  on public.fleet_assets
  for delete
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and (site_id is null or public.can_access_site(site_id))
    and (sub_site_id is null or public.can_access_sub_site(sub_site_id))
  );

drop policy if exists "fleet_asset_obligations_read" on public.fleet_asset_obligations;
drop policy if exists "fleet_asset_obligations_write" on public.fleet_asset_obligations;
drop policy if exists "fleet_asset_obligations_insert" on public.fleet_asset_obligations;
drop policy if exists "fleet_asset_obligations_update" on public.fleet_asset_obligations;
drop policy if exists "fleet_asset_obligations_delete" on public.fleet_asset_obligations;

create policy "fleet_asset_obligations_read"
  on public.fleet_asset_obligations
  for select
  using (
    (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_asset_obligations_insert"
  on public.fleet_asset_obligations
  for insert
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_asset_obligations_update"
  on public.fleet_asset_obligations
  for update
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  )
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_asset_obligations_delete"
  on public.fleet_asset_obligations
  for delete
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

drop policy if exists "fleet_obligation_events_read" on public.fleet_obligation_events;
drop policy if exists "fleet_obligation_events_write" on public.fleet_obligation_events;
drop policy if exists "fleet_obligation_events_insert" on public.fleet_obligation_events;
drop policy if exists "fleet_obligation_events_update" on public.fleet_obligation_events;
drop policy if exists "fleet_obligation_events_delete" on public.fleet_obligation_events;

create policy "fleet_obligation_events_read"
  on public.fleet_obligation_events
  for select
  using (
    (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'))
    and exists (
      select 1
      from public.fleet_asset_obligations o
      join public.fleet_assets a on a.id = o.asset_id
      where o.id = asset_obligation_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_obligation_events_insert"
  on public.fleet_obligation_events
  for insert
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_asset_obligations o
      join public.fleet_assets a on a.id = o.asset_id
      where o.id = asset_obligation_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_obligation_events_update"
  on public.fleet_obligation_events
  for update
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_asset_obligations o
      join public.fleet_assets a on a.id = o.asset_id
      where o.id = asset_obligation_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  )
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_asset_obligations o
      join public.fleet_assets a on a.id = o.asset_id
      where o.id = asset_obligation_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_obligation_events_delete"
  on public.fleet_obligation_events
  for delete
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_asset_obligations o
      join public.fleet_assets a on a.id = o.asset_id
      where o.id = asset_obligation_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

drop policy if exists "fleet_asset_assignments_read" on public.fleet_asset_assignments;
drop policy if exists "fleet_asset_assignments_write" on public.fleet_asset_assignments;
drop policy if exists "fleet_asset_assignments_insert" on public.fleet_asset_assignments;
drop policy if exists "fleet_asset_assignments_update" on public.fleet_asset_assignments;
drop policy if exists "fleet_asset_assignments_delete" on public.fleet_asset_assignments;

create policy "fleet_asset_assignments_read"
  on public.fleet_asset_assignments
  for select
  using (
    (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_asset_assignments_insert"
  on public.fleet_asset_assignments
  for insert
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_asset_assignments_update"
  on public.fleet_asset_assignments
  for update
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  )
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );

create policy "fleet_asset_assignments_delete"
  on public.fleet_asset_assignments
  for delete
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
    and exists (
      select 1
      from public.fleet_assets a
      where a.id = asset_id
        and (a.site_id is null or public.can_access_site(a.site_id))
        and (a.sub_site_id is null or public.can_access_sub_site(a.sub_site_id))
    )
  );
