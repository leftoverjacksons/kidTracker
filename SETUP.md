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

1. In the project, open **SQL Editor** → **New query**.
2. Open [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) on GitHub, click the *copy raw file* button, and paste the whole file into the editor.
3. Click **Run**. It should say *Success. No rows returned*.

## 3. Sign-in settings

1. **Authentication → Sign In / Providers**
   - Turn **off** "Allow new users to sign up". Only accounts you create in the next step can sign in.
   - Make sure **Email** is enabled.
2. **Authentication → URL Configuration**
   - Site URL: `https://leftoverjacksons.github.io/kidTracker/`
   - Redirect URLs: add the same address.
3. **Authentication → Emails → Magic Link** template: add this line to the message body, so the email contains a 6-digit code as well as the link:
   ```
   <p>Your code: <strong>{{ .Token }}</strong></p>
   ```
4. **Authentication → Users → Add user → Create new user**, once for each of you:
   - Email: your real email address
   - Password: anything (it is never used)
   - Tick **Auto Confirm User**.

## 4. Connect GitHub to Supabase

1. In Supabase: **Project Settings → API** (or **Data API** / **API Keys**). Copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **anon / public** key (or **publishable** key). Never use the `service_role` / secret key here.
2. In GitHub, in this repository: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the anon/publishable key
3. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → Deploy to GitHub Pages → Run workflow**. After about 2 minutes the app is live at the address above.

## 5. Install on each phone

1. Open the app address in **Chrome** on the phone.
2. Enter your email → **Email me a sign-in code** → type the code from the email (or tap the link).
3. The first person to sign in adds the baby's name and birth date.
4. Chrome menu **⋮ → Add to Home screen** (or **Install app**). From then on, open it from the home-screen icon. You stay signed in.

---

### Notes

- **Is the anon key secret?** No. It is designed to be public and is visible in the app's code. Access is protected by the database's row-level security, which allows only the accounts listed as caregivers.
- **This repository is public.** The code and design doc are visible to anyone; your data is not (it lives only in Supabase).
- **Free-tier pause:** Supabase pauses a free project after 7 days with no use. Daily logging prevents this. If it ever happens, open the Supabase dashboard and click **Restore**; no data is lost.
