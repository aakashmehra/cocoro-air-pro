// Adds plugins/CocoroIntents.swift (the Shortcuts action) to the iOS app target during prebuild.
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FILE = 'CocoroIntents.swift';

module.exports = function withCocoroIntents(config) {
  config = withDangerousMod(config, ['ios', (cfg) => {
    const dest = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName, FILE);
    fs.copyFileSync(path.join(cfg.modRequest.projectRoot, 'plugins', FILE), dest);
    return cfg;
  }]);
  return withXcodeProject(config, (cfg) => {
    const name = cfg.modRequest.projectName;
    if (!cfg.modResults.hasFile(`${name}/${FILE}`)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${name}/${FILE}`, groupName: name, project: cfg.modResults });
    }
    return cfg;
  });
};
