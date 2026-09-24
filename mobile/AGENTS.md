# Expo HAS CHANGED

Read the exact versioned docs before writing any code. This app pins `expo ~54.0.0`
(`mobile/package.json`), so the docs that apply are:

https://docs.expo.dev/versions/v54.0.0/

Check `mobile/package.json` before trusting this link — if the pin moves, this line is stale.

## Configuration

`mobile/api.js` reads only `EXPO_PUBLIC_API_BASE` from `mobile/.env` (gitignored — copy
`mobile/.env.example`). Cloud builds get it from `mobile/eas.json` instead, because EAS does not
upload gitignored files.

**The dashboard token is not an environment variable.** Expo inlines `EXPO_PUBLIC_*` at build
time, so a token there ships inside the APK — the same mistake as the literal that was once
committed to this public repository. It is entered on first launch (`screens/TokenScreen.js`),
validated against `/dashboard/api/auth/verify`, and stored with `expo-secure-store` (`auth.js`).
Every request sends it as `Authorization: Bearer`, never as a `?token=` query parameter, which
access logs would record.

Restart the dev server after changing `.env`.

## Server API

The app talks only to the `/dashboard` Express router, which Vercel serves as part of the main
function. Routes under `/api/*` belong to the `api/` directory's serverless functions and are a
different auth surface — do not point the app at them.

## Builds

Native code is required for push notifications and widgets, so Expo Go is not enough:

    eas build --profile preview --platform android   # installable APK
    eas build --profile development --platform android   # dev client, for iterating

`mobile/google-services.json` (Firebase) is gitignored; EAS builds receive it as the
`GOOGLE_SERVICES_JSON` file environment variable, wired up in `app.config.js`.
