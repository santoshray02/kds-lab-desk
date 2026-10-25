-- KDS Lab Desk: cloud copy of the lab's data.
-- The lab PC is the ONLY writer (it uses the service_role key, which bypasses row security).
-- Nothing here is readable by the public: the report page goes through the `get-report` Edge Function.

create table if not exists public.patients (
  id          bigint primary key,
  name        text not null,
  title       text,
  sex         text,
  phone       text,
  village     text,
  source      text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.visits (
  id          bigint primary key,
  patient_id  bigint not null,
  sample_id   text not null,
  visit_date  date not null,
  age_y       int,
  age_m       int,
  age_d       int,
  doctor      text,
  specimen    text,
  total       numeric default 0,
  discount    numeric default 0,
  paid        numeric default 0,
  notes       text,
  source      text,
  cancelled   boolean not null default false,
  tests       jsonb not null default '[]'::jsonb,
  payments    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists visits_date_idx on public.visits (visit_date);
create index if not exists visits_doctor_idx on public.visits (lower(doctor));
create index if not exists visits_sample_idx on public.visits (sample_id);

create table if not exists public.reports (
  id           bigint primary key,
  visit_id     bigint not null,
  version      int not null default 1,
  status       text not null,
  is_current   boolean not null default true,
  approved_at  timestamptz,
  reason       text,
  share_code   text,
  pin_salt     text,
  pin_hash     text,
  pdf_path     text,
  results      jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);
create index if not exists reports_code_idx on public.reports (share_code);
create index if not exists reports_visit_idx on public.reports (visit_id);

-- every PIN attempt, used by the Edge Function to slow down guessing
create table if not exists public.report_access_log (
  id          bigserial primary key,
  share_code  text not null,
  at          timestamptz not null default now(),
  ok          boolean not null
);
create index if not exists access_code_at_idx on public.report_access_log (share_code, at desc);

-- Row level security: ON, with no public policies. Only the service role (the lab PC and the Edge Function) gets in.
alter table public.patients          enable row level security;
alter table public.visits            enable row level security;
alter table public.reports           enable row level security;
alter table public.report_access_log enable row level security;

-- Optional: let a signed-in owner account read everything from a phone (no write access).
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'owner reads patients') then
    create policy "owner reads patients" on public.patients for select to authenticated using (true);
    create policy "owner reads visits"   on public.visits   for select to authenticated using (true);
    create policy "owner reads reports"  on public.reports  for select to authenticated using (true);
  end if;
end $$;

-- Private storage bucket for the report PDFs (no public access; links are signed by the Edge Function)
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;
