# YAG website

Run `npm install` and `npm run dev` at the repository root.

The XMB console remains the default view. Append `?workspace=1` to a site URL
to read the same documentation in a sidebar layout. **Return to console**
restores the XMB. Reloading returns to the console at the current document.

Direct links can opt into the reading mode with `?workspace=1`, including
document parameters: `/deploy?view=configuration&workspace=1`.
The original `?view=workspace` link is also supported. The mode marker is
removed after opening; document parameters remain intact.

Workspace View includes protocol examples, keyboard search, repository activity,
mobile navigation, local accent preferences and reduced-motion support.
It inherits the existing site's font variables. Current audio files, sound
preferences, synthesizer, font assets and build exclusions are unchanged.

Nineteen matching icons from the supplied esseti PS3 archive are installed in
`public/icons/xmb/`, using the console's existing SVG override support.
See [artwork provenance and regeneration](../third_party/xmb-icons-esseti/NOTICE.md).

## Console information panel

The panel follows the order in the [PS3 manual](https://manuals.playstation.net/document/en/ps3/current/basicoperations/xmb.html):
avatar, friends, messages, date/time, activity and the news line. It has no
controller battery, network signal, online-presence light or promotional ticker.
The clock uses the viewer's local time. The activity clock appears only while
refreshing repository counts or navigating.

- Friends shows the real GitHub `subscribers_count` (watchers), not stars or live
  presence. The tooltip explains this mapping and gives the last update time.
- The message counter shows all commits on the repository's default branch,
  including merges, using `per_page=1` and the last pagination link. It opens
  the existing notifications; their unread count remains separate.
- The lower line shows the latest bundled commit. Search remains available
  through Ctrl/Cmd+K, `/`, or **Options → Search all destinations**.

Two public GitHub requests refresh the counts on opening the console and at
most once every five minutes while the page is visible. No credentials are
included. Network errors and rate limits keep the last dated snapshot; an
unknown count is shown as a dash, never a fabricated zero. `npm run build`
refreshes the bundled fallback; `npm run sync:repo-stats` refreshes it manually.
These scripts require Node 22.18 or later.

Sources: [GitHub watcher semantics](https://docs.github.com/en/rest/activity/watching),
[commit listing](https://docs.github.com/en/rest/commits/commits#list-commits) and
[pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api).

## Verification

```sh
npx tsc --noEmit
node --test tests/repository-stats.test.mjs
npm run build
npx playwright install chromium
npm run test:site -- --workers=2
```

For an installed Edge browser, set `PLAYWRIGHT_CHANNEL=msedge` before running
the tests or icon extraction script. Playwright starts its own loopback Vite
server and tests console navigation, workspace switching, links, preferences,
clipboard behavior, responsive layout and automated accessibility checks.
