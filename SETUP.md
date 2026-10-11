# Setup guide

You do these steps once, in a browser, about 20 minutes in total. No
programming is needed. Supabase occasionally renames menu items, so if a
label differs slightly, look for the closest match.

App address once deployed: **https://leftoverjacksons.github.io/kidTracker/**

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> and sign up (Sign in with GitHub is easiest).
2. **New project**:
   - Name: `kidtracker`
   - Database password: generate one and **save it in your password manager**. It is needed later for backups.
   - Region: the one closest to you.
   - Plan: **Free**.
3. Wait about 2 minutes for it to finish provisioning.

## 2. Create the database tables

> If you connected Supabase's **GitHub integration**, turn **off** "Deploy to production" in it (Project Settings → Integrations). Database changes are applied by pasting SQL as below; the automatic deploy would try to re-run scripts that are already applied.

1. In the project, open **SQL Editor** → **New query**.
2. Open [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) on GitHub, click the *copy raw file* button, and paste the whole file into the editor.
3. Click **Run**. It should say *Success. No rows returned*.

## 3. Sign-in settings

1. **Authentication → Sign In / Providers**
   - Turn **off** "Allow new users to sign up". Only accounts you create in the next step can sign in.
   - Make sure **Email** is enabled (this covers email + password sign-in).
2. **Authentication → Users → Add user → Create new user**, once for each of you:
   - Email: your real email address
   - Password: one you will remember (each person can change theirs later in the app's Settings)
   - Tick **Auto Confirm User**.

No email templates or URL settings are needed: the app signs in with email + password, so Supabase never has to send an email.

## 4. Connect GitHub to Supabase

1. In Supabase: **Project Settings → API Keys**. Copy the **publishable** key (starts `sb_publishable_`) or, on the *Legacy API keys* tab, the **anon public** key. Never use the `secret` / `service_role` key here.
2. In GitHub, in this repository: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**:
   - Name `VITE_SUPABASE_ANON_KEY`, value = the key from step 1.
   - (The project URL, `https://lusbippzmyvukzpswxxr.supabase.co`, is already built in. Only set `VITE_SUPABASE_URL` if you ever move to a different project.)
3. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → Deploy to GitHub Pages → Run workflow**. After about 2 minutes the app is live at the address above.

## 5. Install on each phone

1. Open the app address in **Chrome** on the phone.
2. Sign in with your email and password.
3. The first person to sign in adds the baby's name and birth date.
4. Chrome menu **⋮ → Add to Home screen** (or **Install app**). From then on, open it from the home-screen icon. You stay signed in.

## 6. Nightly backups (do this once real data exists)

Backups are encrypted, because files produced by GitHub Actions on a public repository can be downloaded by any GitHub user.

1. In Supabase, click **Connect** (top of the project) and copy the **Session pooler** connection string. Replace `[YOUR-PASSWORD]` in it with the database password from step 1.
2. In GitHub: **Settings → Secrets and variables → Actions → Secrets tab → New repository secret**:
   - `SUPABASE_DB_URL` = that connection string
   - `BACKUP_PASSPHRASE` = a long passphrase. **Store it in your password manager.** Without it, nobody can open the backups, including you.
3. **Actions → Nightly backup → Run workflow** once to check it. A green tick means it worked. After that it runs every night and keeps 90 days of backups.

**To restore** (rarely needed): download a `backup-YYYY-MM-DD` artifact from the workflow run, then
```bash
gpg -d kidtracker-YYYY-MM-DD.sql.gpg > kidtracker.sql   # asks for the passphrase
```
The resulting SQL file recreates the tables and data. It can be loaded into a fresh Supabase project's database with `psql`. It does not include the sign-in accounts; recreate those as in step 3.

---

### Notes

- **Is the anon key secret?** No. It is designed to be public and is visible in the app's code. Access is protected by the database's row-level security, which allows only the accounts listed as caregivers.
- **This repository is public.** The code and design doc are visible to anyone; your data is not (it lives only in Supabase).
- **Free-tier pause:** Supabase pauses a free project after 7 days with no use. Daily logging prevents this. If it ever happens, open the Supabase dashboard and click **Restore**; no data is lost.
- **Forgotten password:** in the Supabase **SQL Editor**, run (with the real email and a new password):
  ```sql
  update auth.users
     set encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf'))
   where email = 'you@example.com';
  ```
- **Wiping test data:** paste [`supabase/reset_data.sql`](supabase/reset_data.sql) into the Supabase **SQL Editor** and click **Run**. It deletes all entries, medications, and the baby profile, and keeps both accounts and settings. The app then asks for the baby's details again. This cannot be undone.
