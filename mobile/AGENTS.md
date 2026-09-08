# Expo HAS CHANGED

Read the exact versioned docs before writing any code. This app pins `expo ~54.0.0`
(`mobile/package.json`), so the docs that apply are:

https://docs.expo.dev/versions/v54.0.0/

Check `mobile/package.json` before trusting this link — if the pin moves, this line is stale.

## Configuration

`mobile/api.js` reads `EXPO_PUBLIC_API_BASE` and `EXPO_PUBLIC_API_TOKEN` from `mobile/.env`
(gitignored — copy `mobile/.env.example`). Never hardcode either: both were previously literals in
a public repository, which published the token guarding every `/api` route.

Expo inlines `EXPO_PUBLIC_*` at build time, so restart the dev server after changing them.
