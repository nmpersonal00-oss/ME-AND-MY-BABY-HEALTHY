# Wifey & Hubby — Home Page (Step 1)

A responsive, installable mobile web app (PWA) matching the supplied cozy-home reference. The **Home** tab is built; **Habits**, **Chores**, **Wellness**, **Games**, and **More** intentionally have no features yet. Both progress cards open **Habits**.

## What works

- Greeting updates automatically based on the time of day where the app is opened.
- Today's date updates automatically.
- Two individual clocks display Wifey's and Hubby's current time using time-zone-aware `Intl.DateTimeFormat` formatting (including daylight-saving changes).
- Tasks and water show genuine percentages from stored data rather than invented progress. They start at zero until the Habits page is built.
- Both progress meters have animated, glittery liquid fill when the user has made progress.
- Bottom tabs are navigable; the other screens are intentionally empty apart from their names.
- Progress data survives browser refreshes via `localStorage` on the device in use.
- The site supports installation to a phone home screen and basic offline viewing after first visit.

## GitHub upload and publish

1. Create a **new GitHub repository** (e.g., `wifey-hubby`).
2. Upload **all the contents of this folder** to the repository root, including the hidden `.github` folder. Do not upload only the zip file.
3. Commit to the `main` branch.
4. Open your repository's **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
5. Open the **Actions** tab; when the “Publish Wifey & Hubby to GitHub Pages” workflow succeeds, your URL appears in the deployment output and Settings → Pages.
6. On iPhone, open the site in Safari and choose **Share → Add to Home Screen**. On Android, open it in Chrome and choose **Install app** or **Add to Home screen**.

The app can also run locally: from the project folder, run `python3 -m http.server 8000`, then open `http://localhost:8000`. No npm, packages, or paid hosting required.

## Set your two time zones

Open `config.js` and change:

```js
wifeTimeZone: 'America/Los_Angeles',
husbandTimeZone: 'Asia/Manila',
```

These are **examples**, not assumed locations. The default for both is `null`, which means each clock uses the device's local time zone until you supply your actual time zones. A comprehensive list of time-zone IDs is available via the [IANA time zone database](https://www.iana.org/time-zones). The text greeting and date follow the viewer's device local time, while the two labeled clocks follow the configured zones.

Change `waterGoalGlasses: 8` to your target if needed.

## Integration point for the next page

The Habits page will later save task completion and water consumed through the existing small API in `app.js`:

```js
window.CozyApp.setTasks([
  { id: 'task-1', completed: true },
  { id: 'task-2', completed: false }
]);
window.CozyApp.setWaterGlasses(3);
```

Task percentage is `completed / total * 100`. Water percentage is today's recorded glasses divided by `waterGoalGlasses`. Water automatically starts at zero on the next local calendar day. Tasks can optionally have a `date: 'YYYY-MM-DD'` to appear only on that day. Do not run the example unless you actually want to put sample data in your browser.

**Current limitation:** This first step only saves data **locally on each device**. It does not yet share updates between two people or accounts. A secure shared database / sign-in can be added when we build the Habits functionality. GitHub Pages alone cannot synchronize the two phones' data.

## Files

- `index.html` — home screen and six tabs
- `styles.css` — cozy styling, cards, glitter animation, responsive layout
- `app.js` — clocks, date, task/water calculations, navigation, data interface
- `config.js` — both time zones and daily water goal
- `assets/` — visual art inspired by the supplied reference and app icons
- `manifest.webmanifest`, `sw.js` — installable, offline-capable web app
- `.github/workflows/deploy.yml` — GitHub Pages deployment
