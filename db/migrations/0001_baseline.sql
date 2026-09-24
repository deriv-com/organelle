--
-- PostgreSQL database dump
--

-- Organelle v0.1 public baseline. This migration intentionally contains no
-- organization data, credentials, provider-specific fields, or administrator.
CREATE EXTENSION IF NOT EXISTS ltree;


-- Dumped from database version 17.11
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: organelle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA organelle;


--
-- Name: app_role; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.app_role AS ENUM (
    'viewer',
    'developer',
    'editor',
    'publisher',
    'admin'
);


--
-- Name: change_op; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.change_op AS ENUM (
    'create_header',
    'rename_header',
    'delete_header',
    'create_seat',
    'delete_seat',
    'move_node',
    'reorder_node',
    'assign_employee',
    'unassign_employee',
    'set_peer_host',
    'set_override',
    'clear_override',
    'grant_role',
    'revoke_role',
    'fork_sandbox',
    'merge_sandbox',
    'restore_version',
    'set_assistant',
    'update_employee',
    'set_primary_seat',
    'rename_seat',
    'set_leaf_grid_columns',
    'sync_from_live',
    'grant_sandbox_access',
    'change_sandbox_access',
    'revoke_sandbox_access',
    'expire_sandbox_access',
    'reset_oidc_identity'
);


--
-- Name: change_type; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.change_type AS ENUM (
    'manager_change',
    'team_level_restructure_change',
    'internal_movement',
    'new_hire',
    'seat_removed',
    'peer_change',
    'sandbox_merge',
    'snapshot_restore',
    'org_chart_change',
    'promotion_change',
    'demotion',
    'job_title_change',
    'level_change',
    'position_level_change'
);


--
-- Name: command_kind; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.command_kind AS ENUM (
    'user',
    'undo',
    'redo'
);


--
-- Name: conflict_kind; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.conflict_kind AS ENUM (
    'concurrent_move',
    'stale_target',
    'stale_source',
    'concurrent_edit'
);


--
-- Name: employee_status; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.employee_status AS ENUM (
    'joining',
    'active',
    'inactive',
    'resigned',
    'serving_notice'
);


--
-- Name: merge_status; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.merge_status AS ENUM (
    'pending',
    'applying',
    'merged',
    'failed'
);


--
-- Name: node_type; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.node_type AS ENUM (
    'header',
    'seat'
);


--
-- Name: sandbox_access_level; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.sandbox_access_level AS ENUM (
    'viewer',
    'editor'
);


--
-- Name: tree_kind; Type: TYPE; Schema: organelle; Owner: -
--

CREATE TYPE organelle.tree_kind AS ENUM (
    'published',
    'historical',
    'sandbox'
);


--
-- Name: apply_merge(uuid, uuid); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.apply_merge(p_merge_id uuid, p_merger_auth_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
declare
  v_merge    organelle.sandbox_merges%rowtype;
  v_live     organelle.trees%rowtype;
  v_new_id   uuid;
  v_next_seq bigint;
  v_snap     jsonb;
  v_node     jsonb;
  v_asg      jsonb;
  v_override jsonb;
  v_id       uuid;
  v_ver      bigint;
  v_auth     uuid;
begin
  select * into v_merge
    from organelle.sandbox_merges
   where merge_id = p_merge_id
   for update;
  if not found then
    raise exception 'merge % not found', p_merge_id;
  end if;
  if v_merge.status is distinct from 'pending' then
    raise exception 'merge % is not pending', p_merge_id;
  end if;

  select * into v_live
    from organelle.trees
   where kind = 'published'
   for update;
  if not found then
    raise exception 'race_conflict';
  end if;
  if v_live.version_seq is distinct from v_merge.target_seq then
    raise exception 'race_conflict';
  end if;

  v_snap := v_merge.snapshot;
  if v_snap is null or v_snap = '{}'::jsonb then
    raise exception 'merge % has empty snapshot', p_merge_id;
  end if;
  if (v_snap->>'expectedLiveSeq')::bigint is distinct from v_live.version_seq then
    raise exception 'race_conflict';
  end if;

  for v_id, v_ver in
    select key::uuid, value::bigint
      from jsonb_each_text(coalesce(v_snap->'expectedNodeVersions', '{}'::jsonb))
  loop
    if not exists (
      select 1
        from organelle.nodes n
       where n.tree_id = v_live.tree_id
         and n.node_id = v_id
         and n.row_version = v_ver
    ) then
      raise exception 'race_conflict';
    end if;
  end loop;

  if v_merge.sandbox_tree_id is not null then
    update organelle.employees e
       set sandbox_tree_id = null
     where e.sandbox_tree_id = v_merge.sandbox_tree_id
       and exists (
         select 1
           from organelle.seat_assignments sa
          where sa.tree_id = v_merge.sandbox_tree_id
            and sa.employee_auth_id = e.auth_id
       );
  end if;

  v_next_seq := v_live.version_seq + 1;
  v_new_id := gen_random_uuid();

  update organelle.trees
     set kind = 'historical'
   where tree_id = v_live.tree_id;

  insert into organelle.trees (
    tree_id, kind, version_seq, created_by_auth_id, published_at
  ) values (
    v_new_id, 'published', v_next_seq, p_merger_auth_id, now()
  );

  for v_node in select value from jsonb_array_elements(v_snap->'nodes')
  loop
    insert into organelle.nodes (
      tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title,
      position_level, is_assistant, leaf_grid_columns
    ) values (
      v_new_id,
      (v_node->>'node_id')::uuid,
      nullif(v_node->>'parent_node_id', '')::uuid,
      (v_node->>'node_type')::organelle.node_type,
      coalesce((v_node->>'sort_order')::int, 0),
      v_node->>'name',
      v_node->>'job_title',
      (v_node->>'position_level')::smallint,
      coalesce((v_node->>'is_assistant')::boolean, false),
      coalesce((v_node->>'leaf_grid_columns')::smallint, 3)
    );
  end loop;

  for v_asg in select value from jsonb_array_elements(coalesce(v_snap->'assignments', '[]'::jsonb))
  loop
    insert into organelle.seat_assignments (
      tree_id, node_id, employee_auth_id, is_host, is_primary
    ) values (
      v_new_id,
      (v_asg->>'node_id')::uuid,
      (v_asg->>'employee_auth_id')::uuid,
      coalesce((v_asg->>'is_host')::boolean, false),
      false
    );
  end loop;

  for v_asg in select value from jsonb_array_elements(coalesce(v_snap->'assignments', '[]'::jsonb))
  loop
    if coalesce((v_asg->>'is_primary')::boolean, false) then
      update organelle.seat_assignments
         set is_primary = false
       where tree_id = v_new_id
         and employee_auth_id = (v_asg->>'employee_auth_id')::uuid
         and is_primary;
      update organelle.seat_assignments
         set is_primary = true
       where tree_id = v_new_id
         and node_id = (v_asg->>'node_id')::uuid
         and employee_auth_id = (v_asg->>'employee_auth_id')::uuid;
    end if;
  end loop;

  for v_auth in
    select distinct employee_auth_id
      from organelle.seat_assignments
     where tree_id = v_new_id
  loop
    perform organelle.refresh_primary(v_new_id, v_auth, p_merger_auth_id);
  end loop;

  --change: Promote full pending employee snapshots after the new published structure is
  -- materialized. This is the only sandbox path that writes employees.
  for v_override in
    select value from jsonb_array_elements(coalesce(v_snap->'employeeOverrides', '[]'::jsonb))
  loop
    v_auth := (v_override->>'auth_id')::uuid;

    insert into organelle.change_log (
      tree_id, actor_auth_id, op, employee_auth_id, before, after, merge_id
    )
    select
      v_new_id,
      p_merger_auth_id,
      'update_employee',
      e.auth_id,
      jsonb_build_object(
        'full_name', e.full_name,
        'legal_full_name', e.legal_full_name,
        'id', e.id,
        'employment_record', e.employment_record,
        'job_title', e.job_title,
        'position_level', e.position_level,
        'avatar_url', e.avatar_url,
        'office_country', e.office_country,
        'office_location', e.office_location,
        'hiring_company', e.hiring_company,
        'status', e.status,
        'joining_date', e.joining_date,
        'hired_at', e.hired_at,
        'resignation_date', e.resignation_date,
        'last_working_date', e.last_working_date
      ),
      jsonb_build_object(
        'full_name', v_override->'display_name',
        'legal_full_name', v_override->'legal_full_name',
        'id', v_override->'external_id',
        'employment_record', v_override->'employment_record',
        'job_title', v_override->'display_title',
        'position_level', v_override->'position_level',
        'avatar_url', v_override->'avatar_url',
        'office_country', v_override->'office_country',
        'office_location', v_override->'office_location',
        'hiring_company', v_override->'hiring_company',
        'status', v_override->'status',
        'joining_date', v_override->'joining_date',
        'hired_at', v_override->'hired_at',
        'resignation_date', v_override->'resignation_date',
        'last_working_date', v_override->'last_working_date'
      ),
      p_merge_id
    from organelle.employees e
    where e.auth_id = v_auth;

    update organelle.employees
       set full_name = v_override->>'display_name',
           legal_full_name = v_override->>'legal_full_name',
           id = v_override->>'external_id',
           employment_record = v_override->>'employment_record',
           job_title = v_override->>'display_title',
           position_level = (v_override->>'position_level')::smallint,
           avatar_url = v_override->>'avatar_url',
           office_country = v_override->>'office_country',
           office_location = v_override->>'office_location',
           hiring_company = v_override->>'hiring_company',
           status_updated_at = case
             when status is distinct from coalesce(
               (v_override->>'status')::organelle.employee_status,
               status
             )
             then now()
             else status_updated_at
           end,
           status = coalesce(
             (v_override->>'status')::organelle.employee_status,
             status
           ),
           joining_date = (v_override->>'joining_date')::date,
           hired_at = (v_override->>'hired_at')::date,
           resignation_date = (v_override->>'resignation_date')::date,
           last_working_date = (v_override->>'last_working_date')::date
     where auth_id = v_auth;
  end loop;

  if v_merge.sandbox_tree_id is not null then
    --change: Cleanup is explicit here and also protected by the node/tree cascade FK.
    delete from organelle.employee_overrides
     where tree_id = v_merge.sandbox_tree_id;
  end if;

  perform organelle.validate_tree(v_new_id);

  insert into organelle.change_log (
    tree_id, actor_auth_id, op, node_id, employee_auth_id, before, after, merge_id
  )
  select
    v_new_id,
    p_merger_auth_id,
    (item->>'op')::organelle.change_op,
    nullif(item->>'nodeId', '')::uuid,
    nullif(item->>'employeeAuthId', '')::uuid,
    case when item->'before' = 'null'::jsonb then null else item->'before' end,
    case when item->'after' = 'null'::jsonb then null else item->'after' end,
    p_merge_id
  from jsonb_array_elements(coalesce(v_snap->'logs', '[]'::jsonb)) as t(item);

  insert into organelle.change_log (
    tree_id, actor_auth_id, op, before, after, merge_id
  ) values (
    v_new_id,
    p_merger_auth_id,
    'merge_sandbox',
    jsonb_build_object(
      'sandbox_tree_id', v_merge.sandbox_tree_id,
      'target_seq', v_merge.target_seq
    ),
    jsonb_build_object(
      'resulting_tree_id', v_new_id,
      'counts', coalesce(v_merge.counts, '{}'::jsonb)
    ),
    p_merge_id
  );

  update organelle.sandbox_merges
     set status = 'merged',
         merged_at = now(),
         resulting_tree_id = v_new_id
   where merge_id = p_merge_id;

  return v_new_id;
end;
$$;


--
-- Name: apply_sync_to_sandbox(uuid, uuid); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.apply_sync_to_sandbox(p_sync_id uuid, p_actor_auth_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
declare
  v_sync     organelle.sandbox_syncs%rowtype;
  v_live     organelle.trees%rowtype;
  v_sandbox  organelle.trees%rowtype;
  v_snap     jsonb;
  v_node     jsonb;
  v_asg      jsonb;
  v_override jsonb;
  v_id       uuid;
  v_ver      bigint;
  v_auth     uuid;
begin
  select * into v_sync
    from organelle.sandbox_syncs
   where sync_id = p_sync_id
   for update;
  if not found then
    raise exception 'sync % not found', p_sync_id;
  end if;
  if v_sync.status is distinct from 'pending' then
    raise exception 'sync % is not pending', p_sync_id;
  end if;

  select * into v_live
    from organelle.trees
   where kind = 'published'
   for update;
  if not found then
    raise exception 'race_conflict';
  end if;
  if v_live.version_seq is distinct from v_sync.target_seq then
    raise exception 'race_conflict';
  end if;

  select * into v_sandbox
    from organelle.trees
   where tree_id = v_sync.sandbox_tree_id
     and kind = 'sandbox'
   for update;
  if not found then
    raise exception 'sandbox not found';
  end if;
  if v_sandbox.archived_at is not null then
    raise exception 'Sandbox is archived - restore it first';
  end if;

  v_snap := v_sync.snapshot;
  if v_snap is null or v_snap = '{}'::jsonb then
    raise exception 'sync % has empty snapshot', p_sync_id;
  end if;
  if (v_snap->>'expectedLiveSeq')::bigint is distinct from v_live.version_seq then
    raise exception 'race_conflict';
  end if;

  for v_id, v_ver in
    select key::uuid, value::bigint
      from jsonb_each_text(coalesce(v_snap->'expectedNodeVersions', '{}'::jsonb))
  loop
    if not exists (
      select 1
        from organelle.nodes n
       where n.tree_id = v_sandbox.tree_id
         and n.node_id = v_id
         and n.row_version = v_ver
    ) then
      raise exception 'race_conflict';
    end if;
  end loop;

  delete from organelle.seat_assignments
   where tree_id = v_sandbox.tree_id;

  delete from organelle.nodes
   where tree_id = v_sandbox.tree_id;

  for v_node in select value from jsonb_array_elements(v_snap->'nodes')
  loop
    insert into organelle.nodes (
      tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title,
      position_level, is_assistant, leaf_grid_columns
    ) values (
      v_sandbox.tree_id,
      (v_node->>'node_id')::uuid,
      nullif(v_node->>'parent_node_id', '')::uuid,
      (v_node->>'node_type')::organelle.node_type,
      coalesce((v_node->>'sort_order')::int, 0),
      v_node->>'name',
      v_node->>'job_title',
      (v_node->>'position_level')::smallint,
      coalesce((v_node->>'is_assistant')::boolean, false),
      coalesce((v_node->>'leaf_grid_columns')::smallint, 3)
    );
  end loop;

  for v_asg in select value from jsonb_array_elements(coalesce(v_snap->'assignments', '[]'::jsonb))
  loop
    insert into organelle.seat_assignments (
      tree_id, node_id, employee_auth_id, is_host, is_primary
    ) values (
      v_sandbox.tree_id,
      (v_asg->>'node_id')::uuid,
      (v_asg->>'employee_auth_id')::uuid,
      coalesce((v_asg->>'is_host')::boolean, false),
      false
    );
  end loop;

  for v_asg in select value from jsonb_array_elements(coalesce(v_snap->'assignments', '[]'::jsonb))
  loop
    if coalesce((v_asg->>'is_primary')::boolean, false) then
      update organelle.seat_assignments
         set is_primary = false
       where tree_id = v_sandbox.tree_id
         and employee_auth_id = (v_asg->>'employee_auth_id')::uuid
         and is_primary;
      update organelle.seat_assignments
         set is_primary = true
       where tree_id = v_sandbox.tree_id
         and node_id = (v_asg->>'node_id')::uuid
         and employee_auth_id = (v_asg->>'employee_auth_id')::uuid;
    end if;
  end loop;

  for v_override in
    select value from jsonb_array_elements(coalesce(v_snap->'employeeOverrides', '[]'::jsonb))
  loop
    --change: If the origin node was removed by sync, the pending employee override is
    -- discarded rather than reattached to an unknown seat.
    if v_override->>'node_id' is not null and exists (
      select 1
        from organelle.nodes
       where tree_id = v_sandbox.tree_id
         and node_id = (v_override->>'node_id')::uuid
    ) then
      insert into organelle.employee_overrides (
        tree_id, node_id, auth_id, display_name, display_title, avatar_url,
        legal_full_name, office_country, office_location, hiring_company,
        status, joining_date, hired_at, resignation_date, last_working_date,
        external_id, employment_record, position_level,
        primary_manager_auth_id, primary_team_path, updated_by
      ) values (
        v_sandbox.tree_id,
        (v_override->>'node_id')::uuid,
        (v_override->>'auth_id')::uuid,
        v_override->>'display_name',
        v_override->>'display_title',
        v_override->>'avatar_url',
        v_override->>'legal_full_name',
        v_override->>'office_country',
        v_override->>'office_location',
        v_override->>'hiring_company',
        (v_override->>'status')::organelle.employee_status,
        (v_override->>'joining_date')::date,
        (v_override->>'hired_at')::date,
        (v_override->>'resignation_date')::date,
        (v_override->>'last_working_date')::date,
        v_override->>'external_id',
        v_override->>'employment_record',
        (v_override->>'position_level')::smallint,
        (v_override->>'primary_manager_auth_id')::uuid,
        v_override->>'primary_team_path',
        p_actor_auth_id
      );
    end if;
  end loop;

  for v_auth in
    select distinct employee_auth_id
      from organelle.seat_assignments
     where tree_id = v_sandbox.tree_id
  loop
    perform organelle.refresh_primary(v_sandbox.tree_id, v_auth, p_actor_auth_id);
  end loop;

  update organelle.trees
     set forked_from_tree_id = v_live.tree_id,
         forked_from_seq = v_live.version_seq
   where tree_id = v_sandbox.tree_id;

  perform organelle.validate_tree(v_sandbox.tree_id);

  delete from organelle.change_log
   where tree_id = v_sandbox.tree_id
     and command_id is not null;

  insert into organelle.change_log (
    tree_id, actor_auth_id, op, node_id, employee_auth_id, before, after
  )
  select
    v_sandbox.tree_id,
    p_actor_auth_id,
    (item->>'op')::organelle.change_op,
    nullif(item->>'nodeId', '')::uuid,
    nullif(item->>'employeeAuthId', '')::uuid,
    case when item->'before' = 'null'::jsonb then null else item->'before' end,
    case when item->'after' = 'null'::jsonb then null else item->'after' end
  from jsonb_array_elements(coalesce(v_snap->'logs', '[]'::jsonb)) as t(item);

  insert into organelle.change_log (
    tree_id, actor_auth_id, op, before, after
  ) values (
    v_sandbox.tree_id,
    p_actor_auth_id,
    'sync_from_live',
    jsonb_build_object(
      'forked_from_seq', v_sync.forked_from_seq,
      'target_seq', v_sync.target_seq
    ),
    jsonb_build_object(
      'counts', coalesce(v_sync.counts, '{}'::jsonb)
    )
  );

  update organelle.sandbox_syncs
     set status = 'merged',
         merged_at = now()
   where sync_id = p_sync_id;

  return v_sandbox.tree_id;
end;
$$;


--
-- Name: denormalize_primary(uuid, uuid, uuid); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.denormalize_primary(p_tree_id uuid, p_auth_id uuid, p_actor uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
declare
  v_kind    organelle.tree_kind;
  v_node_id uuid;
  v_title   varchar;
  v_mgr     uuid;
  v_path    varchar;
begin
  select kind into v_kind
    from organelle.trees
   where tree_id = p_tree_id;

  if v_kind is null then
    return;
  end if;

  if not exists (
    select 1 from organelle.employees where auth_id = p_auth_id
  ) then
    return;
  end if;

  select sa.node_id, n.job_title
    into v_node_id, v_title
    from organelle.seat_assignments sa
    join organelle.nodes n
      on n.tree_id = sa.tree_id and n.node_id = sa.node_id
   where sa.tree_id = p_tree_id
     and sa.employee_auth_id = p_auth_id
     and sa.is_primary;

  if v_node_id is null then
    if v_kind = 'sandbox' then
      update organelle.employee_overrides
         set primary_manager_auth_id = null,
             primary_team_path = null,
             updated_by = p_actor,
             updated_at = now()
       where tree_id = p_tree_id and auth_id = p_auth_id;
    else
      update organelle.employees
         set primary_manager_auth_id = null,
             primary_team_path = null
       where auth_id = p_auth_id;
    end if;
    return;
  end if;

  select sa.employee_auth_id
    into v_mgr
    from (
      with recursive walk as (
        select parent_node_id as node_id, 1 as d
          from organelle.nodes
         where tree_id = p_tree_id and node_id = v_node_id
        union all
        select n.parent_node_id, w.d + 1
          from organelle.nodes n
          join walk w on n.tree_id = p_tree_id and n.node_id = w.node_id
         where w.node_id is not null and w.d < 32
      )
      select n.node_id
        from walk w
        join organelle.nodes n
          on n.tree_id = p_tree_id and n.node_id = w.node_id
       where n.node_type = 'seat'
       order by w.d
       limit 1
    ) anc
    join organelle.seat_assignments sa
      on sa.tree_id = p_tree_id
     and sa.node_id = anc.node_id
     and sa.is_host;

  select string_agg(w.name, ' › ' order by w.ord desc)
    into v_path
    from (
      with recursive walk as (
        select parent_node_id as node_id, name, node_type, 1 as ord
          from organelle.nodes
         where tree_id = p_tree_id and node_id = v_node_id
        union all
        select n.parent_node_id, n.name, n.node_type, w.ord + 1
          from organelle.nodes n
          join walk w on n.tree_id = p_tree_id and n.node_id = w.node_id
         where w.node_id is not null and w.ord < 32
      )
      select name, ord
        from walk
       where node_type = 'header' and name is not null
    ) w;

  if v_kind = 'sandbox' then
    update organelle.employee_overrides
       set primary_manager_auth_id = v_mgr,
           primary_team_path = v_path,
           updated_by = p_actor,
           updated_at = now()
     where tree_id = p_tree_id and auth_id = p_auth_id;
  else
    update organelle.employees
       set job_title = coalesce(v_title, job_title),
           primary_manager_auth_id = v_mgr,
           primary_team_path = v_path
     where auth_id = p_auth_id;
  end if;
end;
$$;


--
-- Name: ensure_one_primary(uuid, uuid); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.ensure_one_primary(p_tree_id uuid, p_auth_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
begin
  if exists (
    select 1
      from organelle.seat_assignments
     where tree_id = p_tree_id
       and employee_auth_id = p_auth_id
       and is_primary
  ) then
    return;
  end if;

  update organelle.seat_assignments sa
     set is_primary = true
    from (
      select node_id
        from organelle.seat_assignments
       where tree_id = p_tree_id
         and employee_auth_id = p_auth_id
       order by assigned_at, node_id
       limit 1
    ) first
   where sa.tree_id = p_tree_id
     and sa.employee_auth_id = p_auth_id
     and sa.node_id = first.node_id;
end;
$$;


--
-- Name: node_label(uuid); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.node_label(p_node_id uuid) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
  select translate(p_node_id::text, '-', '_')
$$;


--
-- Name: nodes_repath_subtree(); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.nodes_repath_subtree() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
begin
  update organelle.nodes child
     set path = new.path || subpath(child.path, nlevel(old.path))
   where child.tree_id = new.tree_id
     and child.path <@ old.path
     and child.node_id <> new.node_id;
  return null;
end;
$$;


--
-- Name: nodes_set_path(); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.nodes_set_path() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
begin
  if new.parent_node_id is null then
    new.path := organelle.node_label(new.node_id)::ltree;
  else
    select p.path || organelle.node_label(new.node_id)::ltree
      into new.path
      from organelle.nodes p
     where p.tree_id = new.tree_id
       and p.node_id = new.parent_node_id;

    if new.path is null then
      raise exception 'parent node % not found in tree %', new.parent_node_id, new.tree_id;
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: nodes_touch(); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.nodes_touch() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
begin
  if new.parent_node_id is distinct from old.parent_node_id
     or new.sort_order is distinct from old.sort_order
     or new.name is distinct from old.name
     or new.job_title is distinct from old.job_title
     or new.position_level is distinct from old.position_level
     or new.is_assistant is distinct from old.is_assistant
     or new.leaf_grid_columns is distinct from old.leaf_grid_columns then
    new.updated_at := now();
    new.row_version := old.row_version + 1;
  end if;
  return new;
end;
$$;


--
-- Name: refresh_primary(uuid, uuid, uuid); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.refresh_primary(p_tree_id uuid, p_auth_id uuid, p_actor uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
begin
  perform organelle.ensure_one_primary(p_tree_id, p_auth_id);
  perform organelle.denormalize_primary(p_tree_id, p_auth_id, p_actor);
end;
$$;


--
-- Name: validate_tree(uuid); Type: FUNCTION; Schema: organelle; Owner: -
--

CREATE FUNCTION organelle.validate_tree(p_tree_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'organelle', 'public', 'pg_catalog'
    AS $$
declare
  v_root_count integer;
  v_node_count integer;
  v_reached    integer;
  v_max_depth  integer;
  v_bad        integer;
begin
  select count(*) into v_root_count
    from organelle.nodes
   where tree_id = p_tree_id and parent_node_id is null;

  if v_root_count <> 1 then
    raise exception 'tree % invalid: expected exactly 1 root, found %',
      p_tree_id, v_root_count;
  end if;

  with recursive walk as (
    select n.node_id, 1 as depth, array[n.node_id] as seen
      from organelle.nodes n
     where n.tree_id = p_tree_id and n.parent_node_id is null
    union all
    select c.node_id, w.depth + 1, w.seen || c.node_id
      from organelle.nodes c
      join walk w on c.parent_node_id = w.node_id
     where c.tree_id = p_tree_id
       and c.node_id <> all (w.seen)
  )
  select count(*), max(depth) into v_reached, v_max_depth from walk;

  select count(*) into v_node_count
    from organelle.nodes
   where tree_id = p_tree_id;

  if v_reached < v_node_count then
    raise exception 'tree % invalid: % of % nodes unreachable from root (orphan or cycle)',
      p_tree_id, v_node_count - v_reached, v_node_count;
  end if;

  if v_max_depth > 16 then
    raise exception 'tree % invalid: depth % exceeds maximum of 16',
      p_tree_id, v_max_depth;
  end if;

  select count(*) into v_bad
    from organelle.nodes a
   where a.tree_id = p_tree_id
     and a.is_assistant
     and a.parent_node_id is null;
  if v_bad > 0 then
    raise exception 'tree % invalid: root cannot be an assistant', p_tree_id;
  end if;

  select count(*) into v_bad
    from organelle.nodes a
    join organelle.nodes c
      on c.tree_id = a.tree_id and c.parent_node_id = a.node_id
   where a.tree_id = p_tree_id and a.is_assistant;
  if v_bad > 0 then
    raise exception 'tree % invalid: assistant cannot have children', p_tree_id;
  end if;

  select count(*) into v_bad
    from organelle.nodes a
    join organelle.nodes p
      on p.tree_id = a.tree_id and p.node_id = a.parent_node_id
   where a.tree_id = p_tree_id
     and a.is_assistant
     and p.node_type = 'header';
  if v_bad > 0 then
    raise exception 'tree % invalid: assistant parent must be a seat', p_tree_id;
  end if;

  if exists (
    select 1
      from organelle.nodes a
      left join organelle.seat_assignments sa
        on sa.tree_id = a.tree_id and sa.node_id = a.node_id
     where a.tree_id = p_tree_id and a.is_assistant
     group by a.node_id
    having count(sa.employee_auth_id) <> 1
  ) then
    raise exception 'tree % invalid: assistant must have exactly one member', p_tree_id;
  end if;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_keys; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    scopes text[] NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '90 days'::interval) NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT api_keys_hash_nonempty CHECK ((length(key_hash) > 0)),
    CONSTRAINT api_keys_label_max_len CHECK ((length(label) <= 200)),
    CONSTRAINT api_keys_label_nonempty CHECK ((length(TRIM(BOTH FROM label)) > 0)),
    CONSTRAINT api_keys_prefix_nonempty CHECK ((length(key_prefix) > 0)),
    CONSTRAINT api_keys_scopes_nonempty CHECK ((cardinality(scopes) > 0)),
    CONSTRAINT api_keys_expiry_after_creation CHECK (expires_at > created_at)
);


--
-- Name: app_roles; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.app_roles (
    auth_id uuid NOT NULL,
    role organelle.app_role NOT NULL,
    granted_by uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: change_log; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.change_log (
    id bigint NOT NULL,
    tree_id uuid,
    actor_auth_id uuid NOT NULL,
    op organelle.change_op NOT NULL,
    node_id uuid,
    employee_auth_id uuid,
    before jsonb,
    after jsonb,
    merge_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    command_id uuid,
    command_kind organelle.command_kind,
    undoes_command_id uuid
);


--
-- Name: change_log_id_seq; Type: SEQUENCE; Schema: organelle; Owner: -
--

ALTER TABLE organelle.change_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME organelle.change_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: employee_overrides; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.employee_overrides (
    tree_id uuid NOT NULL,
    node_id uuid NOT NULL,
    auth_id uuid NOT NULL,
    display_name character varying,
    display_title character varying,
    avatar_url character varying,
    legal_full_name character varying,
    office_country character varying,
    office_location character varying,
    hiring_company character varying,
    status organelle.employee_status,
    joining_date date,
    hired_at date,
    resignation_date date,
    last_working_date date,
    external_id character varying,
    employment_record character varying,
    position_level smallint,
    primary_manager_auth_id uuid,
    primary_team_path character varying,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_overrides_last_working_date_requires_exit_status CHECK (((last_working_date IS NULL) OR ((status IS NOT NULL) AND (status = ANY (ARRAY['serving_notice'::organelle.employee_status, 'resigned'::organelle.employee_status]))))),
    CONSTRAINT employee_overrides_serving_notice_requires_last_working_date CHECK (((status <> 'serving_notice'::organelle.employee_status) OR (last_working_date IS NOT NULL)))
);


--
-- Name: employees; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.employees (
    auth_id uuid NOT NULL,
    id character varying,
    employment_record character varying,
    email character varying,
    full_name character varying,
    legal_full_name character varying,
    job_title character varying,
    position_level smallint,
    avatar_url character varying,
    office_country character varying,
    office_location character varying,
    hiring_company character varying,
    status organelle.employee_status NOT NULL,
    joining_date date,
    hired_at date,
    resignation_date date,
    last_working_date date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    primary_manager_auth_id uuid,
    primary_team_path character varying,
    sandbox_tree_id uuid,
    status_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employees_last_working_date_requires_exit_status CHECK (((last_working_date IS NULL) OR ((status IS NOT NULL) AND (status = ANY (ARRAY['serving_notice'::organelle.employee_status, 'resigned'::organelle.employee_status]))))),
    CONSTRAINT employees_serving_notice_requires_last_working_date CHECK (((status <> 'serving_notice'::organelle.employee_status) OR (last_working_date IS NOT NULL)))
);


-- Stable human-login identity. Email is used only for the first binding.
CREATE TABLE organelle.oidc_identities (
    employee_auth_id uuid NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    bound_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT oidc_identities_pkey PRIMARY KEY (employee_auth_id),
    CONSTRAINT oidc_identities_issuer_subject_key UNIQUE (issuer, subject),
    CONSTRAINT oidc_identities_issuer_nonempty CHECK (length(trim(issuer)) > 0),
    CONSTRAINT oidc_identities_subject_nonempty CHECK (length(trim(subject)) > 0)
);


--
-- Name: nodes; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.nodes (
    tree_id uuid NOT NULL,
    node_id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_node_id uuid,
    node_type organelle.node_type NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    name character varying,
    job_title character varying,
    position_level smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    path public.ltree,
    is_assistant boolean DEFAULT false NOT NULL,
    leaf_grid_columns smallint DEFAULT 3 NOT NULL,
    CONSTRAINT nodes_assistant_is_seat CHECK (((NOT is_assistant) OR (node_type = 'seat'::organelle.node_type))),
    CONSTRAINT nodes_header_has_name CHECK (((node_type <> 'header'::organelle.node_type) OR (name IS NOT NULL))),
    CONSTRAINT nodes_leaf_grid_columns_range CHECK (((leaf_grid_columns >= 1) AND (leaf_grid_columns <= 5))),
    CONSTRAINT nodes_seat_has_no_name CHECK (((node_type <> 'seat'::organelle.node_type) OR (name IS NULL)))
);


--
-- Name: sandbox_employee_edits; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.sandbox_employee_edits (
    tree_id uuid NOT NULL,
    employee_auth_id uuid NOT NULL,
    before_data jsonb NOT NULL,
    after_data jsonb NOT NULL,
    CONSTRAINT sandbox_employee_edits_check CHECK (((jsonb_typeof(before_data) = 'object'::text) AND (jsonb_typeof(after_data) = 'object'::text)))
);


--
-- Name: sandbox_merges; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.sandbox_merges (
    merge_id uuid DEFAULT gen_random_uuid() NOT NULL,
    sandbox_tree_id uuid,
    forked_from_seq bigint NOT NULL,
    target_seq bigint NOT NULL,
    resulting_tree_id uuid,
    merger_auth_id uuid NOT NULL,
    status organelle.merge_status DEFAULT 'pending'::organelle.merge_status NOT NULL,
    title text,
    resolutions jsonb DEFAULT '{}'::jsonb NOT NULL,
    included_keys jsonb,
    counts jsonb,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    merged_at timestamp with time zone,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    publish_change_type organelle.change_type,
    change_reason_overrides jsonb,
    CONSTRAINT sandbox_merges_change_reason_overrides_object CHECK (((change_reason_overrides IS NULL) OR (jsonb_typeof(change_reason_overrides) = 'object'::text)))
);


--
-- Name: sandbox_shares; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.sandbox_shares (
    share_id uuid DEFAULT gen_random_uuid() NOT NULL,
    sandbox_tree_id uuid NOT NULL,
    recipient_auth_id uuid NOT NULL,
    access_level organelle.sandbox_access_level NOT NULL,
    granted_by_auth_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by_auth_id uuid,
    expired_at timestamp with time zone,
    expiry_reason text,
    CONSTRAINT sandbox_shares_expiry_reason CHECK ((((expired_at IS NULL) AND (expiry_reason IS NULL)) OR ((expired_at IS NOT NULL) AND (expiry_reason = 'published'::text)))),
    CONSTRAINT sandbox_shares_one_end_state CHECK ((NOT ((revoked_at IS NOT NULL) AND (expired_at IS NOT NULL))))
);


--
-- Name: sandbox_syncs; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.sandbox_syncs (
    sync_id uuid DEFAULT gen_random_uuid() NOT NULL,
    sandbox_tree_id uuid NOT NULL,
    forked_from_seq bigint NOT NULL,
    target_seq bigint NOT NULL,
    actor_auth_id uuid NOT NULL,
    status organelle.merge_status DEFAULT 'pending'::organelle.merge_status NOT NULL,
    resolutions jsonb DEFAULT '{}'::jsonb NOT NULL,
    counts jsonb,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    merged_at timestamp with time zone
);


--
-- Name: seat_assignments; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.seat_assignments (
    tree_id uuid NOT NULL,
    node_id uuid NOT NULL,
    employee_auth_id uuid NOT NULL,
    is_host boolean DEFAULT false NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    is_primary boolean DEFAULT false NOT NULL
);


--
-- Name: trees; Type: TABLE; Schema: organelle; Owner: -
--

CREATE TABLE organelle.trees (
    tree_id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind organelle.tree_kind NOT NULL,
    version_seq bigint,
    forked_from_tree_id uuid,
    forked_from_seq bigint,
    name text,
    owner_auth_id uuid,
    created_by_auth_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    archived_at timestamp with time zone,
    CONSTRAINT trees_sandbox_fields CHECK ((((kind = 'sandbox'::organelle.tree_kind) AND (name IS NOT NULL) AND (owner_auth_id IS NOT NULL) AND (forked_from_tree_id IS NOT NULL) AND (forked_from_seq IS NOT NULL)) OR (kind <> 'sandbox'::organelle.tree_kind))),
    CONSTRAINT trees_seq_for_versions CHECK ((((kind = ANY (ARRAY['published'::organelle.tree_kind, 'historical'::organelle.tree_kind])) AND (version_seq IS NOT NULL)) OR ((kind = 'sandbox'::organelle.tree_kind) AND (version_seq IS NULL))))
);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: app_roles app_roles_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.app_roles
    ADD CONSTRAINT app_roles_pkey PRIMARY KEY (auth_id);


--
-- Name: change_log change_log_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.change_log
    ADD CONSTRAINT change_log_pkey PRIMARY KEY (id);


--
-- Name: employee_overrides employee_overrides_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.employee_overrides
    ADD CONSTRAINT employee_overrides_pkey PRIMARY KEY (tree_id, auth_id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (auth_id);


--
-- Name: nodes nodes_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.nodes
    ADD CONSTRAINT nodes_pkey PRIMARY KEY (tree_id, node_id);


--
-- Name: sandbox_employee_edits sandbox_employee_edits_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_employee_edits
    ADD CONSTRAINT sandbox_employee_edits_pkey PRIMARY KEY (tree_id, employee_auth_id);


--
-- Name: sandbox_merges sandbox_merges_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_merges
    ADD CONSTRAINT sandbox_merges_pkey PRIMARY KEY (merge_id);


--
-- Name: sandbox_shares sandbox_shares_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_shares
    ADD CONSTRAINT sandbox_shares_pkey PRIMARY KEY (share_id);


--
-- Name: sandbox_syncs sandbox_syncs_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_syncs
    ADD CONSTRAINT sandbox_syncs_pkey PRIMARY KEY (sync_id);


--
-- Name: seat_assignments seat_assignments_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.seat_assignments
    ADD CONSTRAINT seat_assignments_pkey PRIMARY KEY (tree_id, node_id, employee_auth_id);


--
-- Name: trees trees_pkey; Type: CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.trees
    ADD CONSTRAINT trees_pkey PRIMARY KEY (tree_id);


--
-- Name: api_keys_active_idx; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX api_keys_active_idx ON organelle.api_keys USING btree (id) WHERE (revoked_at IS NULL);


--
-- Name: api_keys_key_prefix_uidx; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX api_keys_key_prefix_uidx ON organelle.api_keys USING btree (key_prefix);


--
-- Name: cl_actor; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX cl_actor ON organelle.change_log USING btree (actor_auth_id, created_at);


--
-- Name: cl_command; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX cl_command ON organelle.change_log USING btree (tree_id, command_id) WHERE (command_id IS NOT NULL);


--
-- Name: cl_merge; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX cl_merge ON organelle.change_log USING btree (merge_id) WHERE (merge_id IS NOT NULL);


--
-- Name: cl_node; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX cl_node ON organelle.change_log USING btree (tree_id, node_id);


--
-- Name: cl_tree_created; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX cl_tree_created ON organelle.change_log USING btree (tree_id, created_at);


--
-- Name: employee_overrides_tree_node; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX employee_overrides_tree_node ON organelle.employee_overrides USING btree (tree_id, node_id);


--
-- Name: employees_email_idx; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX employees_email_idx ON organelle.employees USING btree (email);


--
-- Name: employees_email_lower; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX employees_email_lower ON organelle.employees USING btree (lower((email)::text)) WHERE ((email IS NOT NULL) AND (length(TRIM(BOTH FROM email)) > 0));


--
-- Name: employees_lower_idx; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX employees_lower_idx ON organelle.employees USING btree (lower((full_name)::text));


--
-- Name: employees_sandbox_tree; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX employees_sandbox_tree ON organelle.employees USING btree (sandbox_tree_id) WHERE (sandbox_tree_id IS NOT NULL);


--
-- Name: employees_status_idx; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX employees_status_idx ON organelle.employees USING btree (status);


--
-- Name: nodes_one_assistant_per_parent; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX nodes_one_assistant_per_parent ON organelle.nodes USING btree (tree_id, parent_node_id) WHERE is_assistant;


--
-- Name: nodes_one_root; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX nodes_one_root ON organelle.nodes USING btree (tree_id) WHERE (parent_node_id IS NULL);


--
-- Name: nodes_path_gist; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX nodes_path_gist ON organelle.nodes USING gist (path);


--
-- Name: nodes_tree_parent; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX nodes_tree_parent ON organelle.nodes USING btree (tree_id, parent_node_id);


--
-- Name: nodes_tree_type; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX nodes_tree_type ON organelle.nodes USING btree (tree_id, node_type);


--
-- Name: sa_one_host; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX sa_one_host ON organelle.seat_assignments USING btree (tree_id, node_id) WHERE is_host;


--
-- Name: sa_one_primary_seat; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX sa_one_primary_seat ON organelle.seat_assignments USING btree (tree_id, employee_auth_id) WHERE is_primary;


--
-- Name: sa_tree_employee; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX sa_tree_employee ON organelle.seat_assignments USING btree (tree_id, employee_auth_id);


--
-- Name: sandbox_shares_one_active_recipient; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX sandbox_shares_one_active_recipient ON organelle.sandbox_shares USING btree (sandbox_tree_id, recipient_auth_id) WHERE ((revoked_at IS NULL) AND (expired_at IS NULL));


--
-- Name: sandbox_shares_recipient_active; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX sandbox_shares_recipient_active ON organelle.sandbox_shares USING btree (recipient_auth_id, sandbox_tree_id) WHERE ((revoked_at IS NULL) AND (expired_at IS NULL));


--
-- Name: sandbox_shares_tree_history; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX sandbox_shares_tree_history ON organelle.sandbox_shares USING btree (sandbox_tree_id, granted_at DESC);


--
-- Name: sandbox_syncs_sandbox; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX sandbox_syncs_sandbox ON organelle.sandbox_syncs USING btree (sandbox_tree_id);


--
-- Name: trees_one_published; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX trees_one_published ON organelle.trees USING btree (kind) WHERE (kind = 'published'::organelle.tree_kind);


--
-- Name: trees_sandbox_owner; Type: INDEX; Schema: organelle; Owner: -
--

CREATE INDEX trees_sandbox_owner ON organelle.trees USING btree (owner_auth_id) WHERE ((kind = 'sandbox'::organelle.tree_kind) AND (archived_at IS NULL));


--
-- Name: trees_version_seq; Type: INDEX; Schema: organelle; Owner: -
--

CREATE UNIQUE INDEX trees_version_seq ON organelle.trees USING btree (version_seq) WHERE (version_seq IS NOT NULL);


--
-- Name: nodes nodes_repath_subtree; Type: TRIGGER; Schema: organelle; Owner: -
--

CREATE TRIGGER nodes_repath_subtree AFTER UPDATE OF parent_node_id ON organelle.nodes FOR EACH ROW EXECUTE FUNCTION organelle.nodes_repath_subtree();


--
-- Name: nodes nodes_set_path; Type: TRIGGER; Schema: organelle; Owner: -
--

CREATE TRIGGER nodes_set_path BEFORE INSERT OR UPDATE OF parent_node_id ON organelle.nodes FOR EACH ROW EXECUTE FUNCTION organelle.nodes_set_path();


--
-- Name: nodes nodes_touch; Type: TRIGGER; Schema: organelle; Owner: -
--

CREATE TRIGGER nodes_touch BEFORE UPDATE ON organelle.nodes FOR EACH ROW EXECUTE FUNCTION organelle.nodes_touch();


--
-- Name: api_keys api_keys_created_by_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.api_keys
    ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES organelle.employees(auth_id);


--
-- Name: app_roles app_roles_auth_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.app_roles
    ADD CONSTRAINT app_roles_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES organelle.employees(auth_id) ON DELETE CASCADE;


--
-- Name: change_log change_log_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.change_log
    ADD CONSTRAINT change_log_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES organelle.trees(tree_id) ON DELETE SET NULL;


--
-- Name: employee_overrides employee_overrides_auth_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.employee_overrides
    ADD CONSTRAINT employee_overrides_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES organelle.employees(auth_id) ON DELETE CASCADE;


--
-- Name: employee_overrides employee_overrides_tree_id_node_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.employee_overrides
    ADD CONSTRAINT employee_overrides_tree_id_node_id_fkey FOREIGN KEY (tree_id, node_id) REFERENCES organelle.nodes(tree_id, node_id) ON DELETE CASCADE;


--
-- Name: employees employees_sandbox_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.employees
    ADD CONSTRAINT employees_sandbox_tree_id_fkey FOREIGN KEY (sandbox_tree_id) REFERENCES organelle.trees(tree_id) ON DELETE CASCADE;


ALTER TABLE ONLY organelle.oidc_identities
    ADD CONSTRAINT oidc_identities_employee_auth_id_fkey FOREIGN KEY (employee_auth_id) REFERENCES organelle.employees(auth_id) ON DELETE CASCADE;


--
-- Name: nodes nodes_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.nodes
    ADD CONSTRAINT nodes_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES organelle.trees(tree_id) ON DELETE CASCADE;


--
-- Name: nodes nodes_tree_id_parent_node_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.nodes
    ADD CONSTRAINT nodes_tree_id_parent_node_id_fkey FOREIGN KEY (tree_id, parent_node_id) REFERENCES organelle.nodes(tree_id, node_id) ON DELETE RESTRICT;


--
-- Name: sandbox_employee_edits sandbox_employee_edits_employee_auth_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_employee_edits
    ADD CONSTRAINT sandbox_employee_edits_employee_auth_id_fkey FOREIGN KEY (employee_auth_id) REFERENCES organelle.employees(auth_id) ON DELETE CASCADE;


--
-- Name: sandbox_employee_edits sandbox_employee_edits_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_employee_edits
    ADD CONSTRAINT sandbox_employee_edits_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES organelle.trees(tree_id) ON DELETE CASCADE;


--
-- Name: sandbox_merges sandbox_merges_resulting_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_merges
    ADD CONSTRAINT sandbox_merges_resulting_tree_id_fkey FOREIGN KEY (resulting_tree_id) REFERENCES organelle.trees(tree_id);


--
-- Name: sandbox_merges sandbox_merges_sandbox_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_merges
    ADD CONSTRAINT sandbox_merges_sandbox_tree_id_fkey FOREIGN KEY (sandbox_tree_id) REFERENCES organelle.trees(tree_id) ON DELETE SET NULL;


--
-- Name: sandbox_shares sandbox_shares_granted_by_auth_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_shares
    ADD CONSTRAINT sandbox_shares_granted_by_auth_id_fkey FOREIGN KEY (granted_by_auth_id) REFERENCES organelle.employees(auth_id);


--
-- Name: sandbox_shares sandbox_shares_recipient_auth_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_shares
    ADD CONSTRAINT sandbox_shares_recipient_auth_id_fkey FOREIGN KEY (recipient_auth_id) REFERENCES organelle.employees(auth_id) ON DELETE CASCADE;


--
-- Name: sandbox_shares sandbox_shares_revoked_by_auth_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_shares
    ADD CONSTRAINT sandbox_shares_revoked_by_auth_id_fkey FOREIGN KEY (revoked_by_auth_id) REFERENCES organelle.employees(auth_id);


--
-- Name: sandbox_shares sandbox_shares_sandbox_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_shares
    ADD CONSTRAINT sandbox_shares_sandbox_tree_id_fkey FOREIGN KEY (sandbox_tree_id) REFERENCES organelle.trees(tree_id) ON DELETE CASCADE;


--
-- Name: sandbox_syncs sandbox_syncs_sandbox_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.sandbox_syncs
    ADD CONSTRAINT sandbox_syncs_sandbox_tree_id_fkey FOREIGN KEY (sandbox_tree_id) REFERENCES organelle.trees(tree_id) ON DELETE CASCADE;


--
-- Name: seat_assignments seat_assignments_employee_auth_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.seat_assignments
    ADD CONSTRAINT seat_assignments_employee_auth_id_fkey FOREIGN KEY (employee_auth_id) REFERENCES organelle.employees(auth_id) ON DELETE CASCADE;


--
-- Name: seat_assignments seat_assignments_tree_id_node_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.seat_assignments
    ADD CONSTRAINT seat_assignments_tree_id_node_id_fkey FOREIGN KEY (tree_id, node_id) REFERENCES organelle.nodes(tree_id, node_id) ON DELETE CASCADE;


--
-- Name: trees trees_forked_from_tree_id_fkey; Type: FK CONSTRAINT; Schema: organelle; Owner: -
--

ALTER TABLE ONLY organelle.trees
    ADD CONSTRAINT trees_forked_from_tree_id_fkey FOREIGN KEY (forked_from_tree_id) REFERENCES organelle.trees(tree_id);


--
-- PostgreSQL database dump complete
--
