function makePolicy(platform, arch, env = process.env) {
  const channel = `stable-${platform}-${arch}`;
  const macKeys = [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ];
  const winKeys = [
    "WIN_CSC_LINK",
    "WIN_CSC_KEY_PASSWORD",
    "WIN_PUBLISHER_NAME",
  ];
  const keys =
    platform === "darwin" ? macKeys : platform === "win32" ? winKeys : [];
  const requested = keys.some((k) => !!env[k]);
  if (requested && !keys.every((k) => !!env[k]))
    throw new Error(
      "Signing configuration is incomplete. Required: " + keys.join(", "),
    );
  return {
    version: 1,
    platform,
    arch,
    channel,
    signed: requested,
    publisherName:
      platform === "win32" && requested ? env.WIN_PUBLISHER_NAME : "",
    notarized: platform === "darwin" && requested,
  };
}
function feedName(platform, arch) {
  return `stable-${platform}-${arch}${platform === "win32" ? "" : platform === "darwin" ? "-mac" : "-linux" + (arch === "x64" ? "" : "-" + arch)}.yml`;
}
function downloads(version, platform, arch) {
  if (platform === "win32")
    return [
      `HRig-${version}-windows-${arch}-setup.exe`,
      `HRig-${version}-windows-${arch}-portable.exe`,
    ];
  const prefix = `HRig-${version}-${platform === "darwin" ? "macos" : "linux"}-${arch}`;
  return (
    platform === "darwin"
      ? ["dmg", "zip"]
      : ["AppImage", "tar.gz", "deb", "rpm"]
  ).map((ext) => prefix + "." + ext);
}
module.exports = { makePolicy, feedName, downloads };
