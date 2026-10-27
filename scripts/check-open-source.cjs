const fs = require("node:fs");
const path = require("node:path");
function checkOpenSource(pkg, lock, license) {
  if (pkg.license !== "MIT" || lock.packages?.[""]?.license !== "MIT")
    throw new Error(
      "Package and lockfile must both declare the approved MIT license.",
    );
  if (pkg.version !== lock.packages?.[""]?.version)
    throw new Error("Package and lockfile versions differ.");
  const normalized = license.replace(/\s+/g, " ");
  if (
    !normalized.startsWith("MIT License ") ||
    !normalized.includes("Permission is hereby granted, free of charge") ||
    !normalized.includes(
      "The above copyright notice and this permission notice shall be included",
    ) ||
    !normalized.includes('THE SOFTWARE IS PROVIDED "AS IS"')
  )
    throw new Error(
      "The distributed LICENSE must contain the MIT grant, notice condition and warranty disclaimer.",
    );
  const files = pkg.build?.files || [];
  for (const name of [
    "LICENSE",
    "PRIVACY.md",
    "SIGNING.md",
    "THEME_CREDITS.md",
  ])
    if (!files.includes(name))
      throw new Error(`Desktop packaging must include ${name}.`);
  return {
    license: "MIT",
    metadataConsistent: true,
    noticesIncluded: true,
    signPathApproval: "not-verified-by-this-check",
  };
}
if (require.main === module) {
  try {
    const root = path.resolve(__dirname, "..");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    const lock = JSON.parse(
      fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
    );
    for (const file of [
      "LICENSE",
      "PRIVACY.md",
      "SIGNING.md",
      "THEME_CREDITS.md",
    ])
      fs.accessSync(path.join(root, file), fs.constants.R_OK);
    console.log(
      JSON.stringify(
        checkOpenSource(
          pkg,
          lock,
          fs.readFileSync(path.join(root, "LICENSE"), "utf8"),
        ),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { checkOpenSource };
