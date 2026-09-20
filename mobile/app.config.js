// google-services.json configures Firebase Cloud Messaging for this app. It stays out of git
// because the repository is public. EAS cloud builds receive it as a secret file environment
// variable (GOOGLE_SERVICES_JSON); local runs read the gitignored file beside this one.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
