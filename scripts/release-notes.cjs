const fs = require("node:fs");

function validateReleaseNotes(notes) {
  for (const heading of [
    "## Validation",
    "## Known limitations",
    "## Install or upgrade",
    "## Integrity and source",
  ]) {
    if (!notes.includes(heading))
      throw new Error("Missing release notes: " + heading);
  }
}

if (require.main === module) {
  const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid release version.");
  validateReleaseNotes(fs.readFileSync(`releases/v${version}.md`, "utf8"));
  console.log(`Release notes verified: ${version}`);
}
module.exports = { validateReleaseNotes };
