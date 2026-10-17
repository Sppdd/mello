// Signs release builds with your own upload key when these Gradle properties are set
// (put them in ~/.gradle/gradle.properties, never in the repo):
//   MELLO_UPLOAD_STORE_FILE=/absolute/path/to/mello-upload.jks
//   MELLO_UPLOAD_STORE_PASSWORD=...
//   MELLO_UPLOAD_KEY_ALIAS=mello
//   MELLO_UPLOAD_KEY_PASSWORD=...
// Without them, release builds fall back to the debug key (fine for local testing only).
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
        release {
            if (project.hasProperty('MELLO_UPLOAD_STORE_FILE')) {
                storeFile file(MELLO_UPLOAD_STORE_FILE)
                storePassword MELLO_UPLOAD_STORE_PASSWORD
                keyAlias MELLO_UPLOAD_KEY_ALIAS
                keyPassword MELLO_UPLOAD_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (!gradle.includes('MELLO_UPLOAD_STORE_FILE')) {
      gradle = gradle.replace(/signingConfigs \{/, (m) => `${m}${SIGNING}`);
      gradle = gradle.replace(
        /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
        "$1signingConfig project.hasProperty('MELLO_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
      );
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
