// app.json plus the build variant: WIFI_ONLY=1 builds the version with no Sharp account option.
module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, wifiOnly: process.env.WIFI_ONLY === '1' },
});
