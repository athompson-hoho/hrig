# SignPath Foundation application preparation

Status: repository preparation only. No application has been submitted, no SignPath organization/project has been assigned, and no signed Windows release has been produced by this work.

## Project details

| Field | Prepared value |
|---|---|
| Project | HRig |
| Repository and homepage | https://github.com/athompson-hoho/hrig |
| Download page | https://github.com/athompson-hoho/hrig/releases |
| Description | Cross-platform desktop GUI and agentic development workspace for OpenRig. It organizes WSL/SSH agent sessions, source editing and reviews, project/task boards, operator-selected AI assessments and a linked mobile companion. |
| License | MIT; see [LICENSE](../LICENSE). Bundled third-party components retain their original notices and licenses. |
| Maintainer / reviewer / signing approver | [athompson-hoho](https://github.com/athompson-hoho) |
| Contact email | Maintainer must provide directly to SignPath; no email address is inferred or published here. |
| Code signing policy | [SIGNING.md](../SIGNING.md) |
| Privacy statement | [PRIVACY.md](../PRIVACY.md) |
| Build workflow | [.github/workflows/native-release.yml](../.github/workflows/native-release.yml) |
| Windows downloads | `HRig-<version>-windows-x64-setup.exe` and `HRig-<version>-windows-x64-portable.exe` |

## Before applying

1. Publish the reviewed MIT license, matching npm metadata, policy and privacy statement in the public repository. Public visibility was verified during preparation; the live repository did not yet report a license at that point.
2. Confirm repository ownership, GitHub MFA and the signing approver identity. Enable SignPath MFA when onboarding. Confirm who may review code and approve releases; this checklist cannot verify account settings.
3. Review the licenses and notices of bundled dependencies, native modules, Electron and theme assets against the Foundation's conditions. The local open-source check verifies HRig's own license metadata and notices; it is not a full dependency-license audit or an eligibility decision.
4. Ensure a released Windows build and its public description are available. Provide build provenance/release history when requested. Acceptance is discretionary and may require additional project reputation or review.
5. Apply at [SignPath Foundation](https://signpath.org/apply), providing the contact email through their form. Do not submit signing credentials, tokens or private user/project data in a GitHub issue.

## After approval

1. Obtain the organization ID, project slug, release signing-policy slug, approved artifact-configuration slug and exact certificate publisher from SignPath. Record public identifiers in repository variables; put API credentials in restricted Actions/environment secrets.
2. Configure the SignPath GitHub integration and GitHub-hosted build provenance. Each signing request needs explicit release approval. Keep signing credentials out of pull-request builds and source files.
3. Agree the Electron/NSIS signing scope with SignPath before implementing the adapter. The currently prepared PFX route is not a SignPath integration: a Foundation private key is not exported as `WIN_CSC_LINK`. Sign the HRig application before packaging; account for the NSIS uninstaller and both outer EXEs; preserve upstream binary signatures and exclude unrelated third-party executables from project signing.
4. Integrate approved signing stages with the native workflow. Generate feeds, blockmaps, SHA hashes and manifests from the final signed artifacts. Do not post-sign a published EXE while retaining its previous feed or checksum.
5. On a disposable Windows runner, verify the real signature chain, approved publisher and timestamp on all signing-scope artifacts, then run native smoke and installer lifecycle checks. Test certificates and mocked checks do not establish public trust.
6. Enable signed-build/updater policy only after that complete chain passes. Publish a signed release deliberately with the attribution specified in the code signing policy. Existing unsigned releases remain labeled unsigned.

Sources: [Foundation conditions](https://signpath.org/terms), [GitHub trusted builds](https://docs.signpath.io/trusted-build-systems/github), [artifact configuration reference](https://docs.signpath.io/artifact-configuration/reference). SignPath approval, MFA, credentials and actual Windows signature verification remain external/onboarding requirements.
