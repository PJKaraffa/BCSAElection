-- BCSA Anonymous Voting System
-- Run this entire script in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.elections (
  id bigint generated always as identity primary key,
  title text not null,
  status text not null default 'draft' check (status in ('draft','open','closed')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.positions (
  id bigint generated always as identity primary key,
  election_id bigint not null references public.elections(id) on delete cascade,
  name text not null,
  max_selections integer not null check (max_selections > 0),
  display_order integer not null default 1,
  unique(election_id,name)
);

create table if not exists public.candidates (
  id bigint generated always as identity primary key,
  election_id bigint not null references public.elections(id) on delete cascade,
  position_id bigint not null references public.positions(id) on delete cascade,
  name text not null,
  display_order integer not null default 1,
  active boolean not null default true
);

-- Member IDs are never stored in plain text.
create table if not exists public.eligible_voters (
  id bigint generated always as identity primary key,
  election_id bigint not null references public.elections(id) on delete cascade,
  member_hash text not null,
  has_voted boolean not null default false,
  voted_at timestamptz,
  unique(election_id,member_hash)
);

-- Short-lived verification record. It authorizes one submission, but the ballot table has no voter ID.
create table if not exists public.voter_tokens (
  token uuid primary key default gen_random_uuid(),
  election_id bigint not null references public.elections(id) on delete cascade,
  voter_id bigint not null references public.eligible_voters(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);

create table if not exists public.ballots (
  id uuid primary key default gen_random_uuid(),
  election_id bigint not null references public.elections(id) on delete cascade,
  confirmation_number text not null unique,
  submitted_at timestamptz not null default now()
);

create table if not exists public.ballot_selections (
  id bigint generated always as identity primary key,
  ballot_id uuid not null references public.ballots(id) on delete cascade,
  election_id bigint not null references public.elections(id) on delete cascade,
  position_id bigint not null references public.positions(id) on delete cascade,
  candidate_id bigint not null references public.candidates(id) on delete cascade,
  unique(ballot_id,candidate_id)
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;

alter table public.profiles enable row level security;
alter table public.elections enable row level security;
alter table public.positions enable row level security;
alter table public.candidates enable row level security;
alter table public.eligible_voters enable row level security;
alter table public.voter_tokens enable row level security;
alter table public.ballots enable row level security;
alter table public.ballot_selections enable row level security;

create policy "admins read profiles" on public.profiles for select using (public.is_admin() or id=auth.uid());
create policy "admins manage elections" on public.elections for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage positions" on public.positions for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage candidates" on public.candidates for all using (public.is_admin()) with check (public.is_admin());
create policy "admins read eligible voters" on public.eligible_voters for select using (public.is_admin());
create policy "admins read ballots" on public.ballots for select using (public.is_admin());
create policy "admins read ballot selections" on public.ballot_selections for select using (public.is_admin());

create or replace function public.get_public_election()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_election public.elections; v_positions jsonb;
begin
  select * into v_election from public.elections
  where status='open' and now() between starts_at and ends_at
  order by starts_at desc limit 1;
  if v_election.id is null then return jsonb_build_object('election',null); end if;
  select jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'max_selections',p.max_selections,'display_order',p.display_order,
    'candidates',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'display_order',c.display_order) order by c.display_order,c.name),'[]'::jsonb) from public.candidates c where c.position_id=p.id and c.active)
  ) order by p.display_order) into v_positions from public.positions p where p.election_id=v_election.id;
  return jsonb_build_object('election',to_jsonb(v_election),'positions',coalesce(v_positions,'[]'::jsonb));
end; $$;

grant execute on function public.get_public_election() to anon, authenticated;

create or replace function public.verify_voter(p_election_id bigint, p_member_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_voter public.eligible_voters; v_token uuid; v_open boolean;
begin
  select exists(select 1 from public.elections where id=p_election_id and status='open' and now() between starts_at and ends_at) into v_open;
  if not v_open then return jsonb_build_object('valid',false,'message','The election is not open.'); end if;
  select * into v_voter from public.eligible_voters where election_id=p_election_id and member_hash=encode(digest(trim(p_member_id),'sha256'),'hex');
  if v_voter.id is null then return jsonb_build_object('valid',false,'message','That ID is not eligible.'); end if;
  if v_voter.has_voted then return jsonb_build_object('valid',false,'message','That ID has already voted.'); end if;
  delete from public.voter_tokens where voter_id=v_voter.id and used_at is null;
  insert into public.voter_tokens(election_id,voter_id) values(p_election_id,v_voter.id) returning token into v_token;
  return jsonb_build_object('valid',true,'token',v_token);
end; $$;

grant execute on function public.verify_voter(bigint,text) to anon, authenticated;

create or replace function public.submit_anonymous_ballot(p_verification_token uuid, p_selections jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_token public.voter_tokens; v_ballot_id uuid; v_confirmation text; v_item jsonb; v_position bigint; v_candidate bigint; v_expected int; v_received int;
begin
  select * into v_token from public.voter_tokens where token=p_verification_token for update;
  if v_token.token is null or v_token.used_at is not null or v_token.expires_at < now() then return jsonb_build_object('success',false,'message','Verification expired. Please start again.'); end if;
  if exists(select 1 from public.eligible_voters where id=v_token.voter_id and has_voted) then return jsonb_build_object('success',false,'message','This ID has already voted.'); end if;

  for v_position, v_expected in select id,max_selections from public.positions where election_id=v_token.election_id loop
    select count(*) into v_received from jsonb_array_elements(p_selections) x where (x->>'position_id')::bigint=v_position;
    if v_received <> v_expected then return jsonb_build_object('success',false,'message','The ballot is incomplete or contains too many selections.'); end if;
  end loop;

  v_confirmation := upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.ballots(election_id,confirmation_number) values(v_token.election_id,v_confirmation) returning id into v_ballot_id;
  for v_item in select * from jsonb_array_elements(p_selections) loop
    v_position := (v_item->>'position_id')::bigint; v_candidate := (v_item->>'candidate_id')::bigint;
    if not exists(select 1 from public.candidates where id=v_candidate and position_id=v_position and election_id=v_token.election_id and active) then raise exception 'Invalid ballot selection'; end if;
    insert into public.ballot_selections(ballot_id,election_id,position_id,candidate_id) values(v_ballot_id,v_token.election_id,v_position,v_candidate);
  end loop;

  update public.eligible_voters set has_voted=true,voted_at=now() where id=v_token.voter_id;
  update public.voter_tokens set used_at=now() where token=p_verification_token;
  return jsonb_build_object('success',true,'confirmation_number',v_confirmation);
end; $$;

grant execute on function public.submit_anonymous_ballot(uuid,jsonb) to anon, authenticated;

create or replace function public.admin_import_member_ids(p_election_id bigint,p_member_ids text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id text; v_count int:=0;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  foreach v_id in array p_member_ids loop
    insert into public.eligible_voters(election_id,member_hash) values(p_election_id,encode(digest(trim(v_id),'sha256'),'hex')) on conflict do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return jsonb_build_object('imported',v_count);
end; $$;

grant execute on function public.admin_import_member_ids(bigint,text[]) to authenticated;

create or replace function public.admin_save_election(p_id bigint,p_title text,p_status text,p_starts_at timestamptz,p_ends_at timestamptz)
returns bigint language plpgsql security definer set search_path=public as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_id is null then
    insert into public.elections(title,status,starts_at,ends_at,created_by) values(p_title,p_status,p_starts_at,p_ends_at,auth.uid()) returning id into v_id;
    insert into public.positions(election_id,name,max_selections,display_order) values
      (v_id,'President',1,1),(v_id,'Vice President',2,2),(v_id,'Treasurer',1,3),(v_id,'Secretary',1,4),(v_id,'Sergeant at Arms',2,5);
  else
    update public.elections set title=p_title,status=p_status,starts_at=p_starts_at,ends_at=p_ends_at where id=p_id;
    v_id:=p_id;
  end if;
  return v_id;
end; $$;

grant execute on function public.admin_save_election(bigint,text,text,timestamptz,timestamptz) to authenticated;

create or replace function public.get_admin_dashboard()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_election public.elections; v_positions jsonb; v_eligible int; v_votes int; v_results jsonb;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  select * into v_election from public.elections order by created_at desc limit 1;
  if v_election.id is null then return jsonb_build_object('election',null,'positions','[]'::jsonb,'metrics',jsonb_build_object()); end if;
  select count(*),count(*) filter(where has_voted) into v_eligible,v_votes from public.eligible_voters where election_id=v_election.id;
  select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'max_selections',p.max_selections,'display_order',p.display_order,'candidates',(select coalesce(jsonb_agg(to_jsonb(c) order by c.display_order,c.name),'[]'::jsonb) from public.candidates c where c.position_id=p.id)) order by p.display_order) into v_positions from public.positions p where p.election_id=v_election.id;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_results from (
    select p.name position_name,c.name candidate_name,count(bs.id) vote_count
    from public.candidates c join public.positions p on p.id=c.position_id left join public.ballot_selections bs on bs.candidate_id=c.id
    where c.election_id=v_election.id group by p.name,p.display_order,c.name,c.display_order order by p.display_order,c.display_order,c.name
  ) r;
  return jsonb_build_object('election',to_jsonb(v_election),'positions',coalesce(v_positions,'[]'::jsonb),'metrics',jsonb_build_object('eligible_count',v_eligible,'votes_cast',v_votes,'turnout',case when v_eligible=0 then 0 else v_votes*100.0/v_eligible end),'results',v_results);
end; $$;

grant execute on function public.get_admin_dashboard() to authenticated;

-- Create your first administrator after signing that person up in Supabase Authentication:
-- insert into public.profiles(id,full_name,role)
-- select id,'PJ Karaffa','admin' from auth.users where email='YOUR_ADMIN_EMAIL';
