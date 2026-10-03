-- Auto-provision app_user from auth.users.
--
-- Mirroring Supabase auth users into public.app_user via a client call to our
-- Express /api/auth/sync was fragile — if that call didn't fire (restored
-- session, network blip), the app_user row was missing and every document
-- insert failed the owner_id foreign key. This trigger makes provisioning a
-- database guarantee instead: every new auth user gets an app_user row.

create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_user (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', null)
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Backfill any existing auth users that have no app_user row yet.
insert into public.app_user (id, email, name)
select u.id, coalesce(u.email, ''), u.raw_user_meta_data->>'name'
from auth.users u
left join public.app_user a on a.id = u.id
where a.id is null;
