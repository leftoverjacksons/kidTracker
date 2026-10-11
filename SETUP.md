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
4. Do the same with [`supabase/migrations/0002_reports.sql`](supabase/migrations/0002_reports.sql) (the Reports tab needs it). It is safe to run more than once.

Later database changes will arrive as new numbered files in `supabase/migrations/`. Run each new one the same way, in order.

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

## 6. Nightly backups to Google Drive (about 10 minutes)

A small script in your own Google account runs every night around 3 am. It:

- saves a complete snapshot (`kidtracker-YYYY-MM-DD.json`) in a Drive folder called **kidTracker backups**, keeping the last 365 days;
- rewrites a Google Sheet called **kidTracker data** (in the same folder) with one tab per category, in your units;
- keeps the free Supabase project from pausing, because it signs in every night.

**a. Create a backup login in Supabase.** Go to **Authentication → Users → Add user → Create new user**:
   - Email: any address you control. A Gmail "plus" address works and needs no new account, e.g. `yourname+kidtracker-backup@gmail.com`.
   - Password: a long random one. Store it in your password manager.
   - Tick **Auto Confirm User**.

**b. Create the script.**
   1. Go to <https://script.google.com>, click **New project**, and rename it (top left) to `kidTracker backup`.
   2. Open [`backup/Code.gs`](backup/Code.gs) on GitHub and click the *copy raw file* button. In the script editor, select everything in `Code.gs`, delete it, and paste.
   3. Click 💾 **Save**.

**c. Enter the settings.** Click ⚙️ **Project Settings** (left sidebar), scroll to **Script Properties**, choose **Add script property**, and add:

| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://lusbippzmyvukzpswxxr.supabase.co` |
| `SUPABASE_KEY` | the same publishable/anon key you gave GitHub |
| `BACKUP_EMAIL` | the backup login's email from step a |
| `BACKUP_PASSWORD` | the backup login's password |
| `KEEP_DAYS` | optional; how many days of snapshots to keep (default 365) |

Click **Save script properties**.

**d. Run it once.** Go back to the **Editor** (`< >` icon). In the toolbar's function dropdown choose **setup**, then click **▶ Run**.
   - Google asks you to authorize. Choose your account. Because this is your own unpublished script, Google shows *"Google hasn't verified this app"*: click **Advanced → Go to kidTracker backup (unsafe)** → **Allow**. The script asks for Drive and Sheets access (to write the backup) and external requests (to reach Supabase).
   - The log at the bottom should end with *"Setup complete. Saved kidtracker-…json"*.
   - Check Google Drive: the **kidTracker backups** folder now contains a snapshot and the **kidTracker data** sheet.

That's all. It now runs nightly by itself. If a run ever fails, Google emails you. The usual causes are a changed backup password or a paused Supabase project.

**Don't edit the Sheet.** It is overwritten every night. Make changes in the app.

**To restore** (rarely needed):
1. Download a snapshot `.json` from the Drive folder.
2. Open <https://leftoverjacksons.github.io/kidTracker/restore.html> and choose the file. It turns the file into SQL inside your browser; nothing is uploaded.
3. Copy the SQL, paste it into Supabase **SQL Editor**, and click **Run**.

This replaces all logged data with the snapshot. Sign-in accounts are not affected. On a brand-new Supabase project, first run steps 2 and 3 of this guide.

---

### Notes

- **Is the anon key secret?** No. It is designed to be public and is visible in the app's code. Access is protected by the database's row-level security, which allows only the accounts listed as caregivers.
- **This repository is public.** The code and design doc are visible to anyone; your data is not (it lives only in Supabase).
- **Free-tier pause:** Supabase pauses a free project after 7 days with no use. Daily logging and the nightly backup both prevent this. If it ever happens, open the Supabase dashboard and click **Restore**; no data is lost.
- **Forgotten password:** in the Supabase **SQL Editor**, run (with the real email and a new password):
  ```sql
  update auth.users
     set encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf'))
   where email = 'you@example.com';
  ```
- **Wiping test data:** paste [`supabase/reset_data.sql`](supabase/reset_data.sql) into the Supabase **SQL Editor** and click **Run**. It deletes all entries, medications, and the baby profile, and keeps both accounts and settings. The app then asks for the baby's details again. This cannot be undone.
