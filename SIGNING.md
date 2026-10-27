# Code signing policy

## Current status

HRig is licensed under [MIT](LICENSE). Free Windows code signing through [SignPath Foundation](https://signpath.org/) is the intended route. HRig has not yet obtained SignPath approval or configured a SignPath signing adapter. Existing downloads remain unsigned unless a release explicitly identifies and verifies its signatures. No certificate or trusted signature is created by adding this policy.

The repository owner [athompson-hoho](https://github.com/athompson-hoho) is the project maintainer, reviewer and release approver. Additional contributors' changes require maintainer review before release. Signing approvers must use multi-factor authentication for GitHub and SignPath. Maintainer MFA and SignPath enrollment must be confirmed during onboarding; this repository does not assert that either has already been verified.

## Eligible artifacts and approvals

- Signing requests are limited to HRig releases built from reviewed commits in [this repository](https://github.com/athompson-hoho/hrig), on GitHub-hosted runners with verifiable build provenance.
- The intended Windows scope is the HRig application and project-owned installer/uninstaller/portable executables. The precise artifact configuration, including Electron packaging, must be approved by SignPath before integration. Upstream runtime components and libraries retain their own signatures and licenses; HRig does not blanket-sign third-party DLLs or tools using a Foundation certificate.
- Each release requires an explicit signing approval by the release approver. A pull request or an untrusted branch cannot approve its own signing request. The approved workflow, artifact configuration and source revision determine what may be signed.
- Product metadata must identify HRig and the release version. After signing, Windows must report a valid Authenticode signature and the exact approved publisher identity. Setup and portable downloads are both checked. A release timestamp is required for the planned SignPath route.
- Signing must finish before the final update feeds, blockmaps, checksums and release manifest are generated. Any change to an artifact after signing requires fresh verification and regenerated integrity metadata. The packaged executable must be signed before it is placed in the installer; signing only an outer EXE is insufficient for the planned signed-app update policy.
- Publishing requires the existing native release checks, packaged smoke test and Windows install/uninstall test. A signing failure does not permit an unsigned replacement to be published as signed.

## Publisher attribution

Approval is at the Foundation's discretion. With a Foundation-issued certificate, the certificate publisher is SignPath Foundation rather than an invented HRig legal identity. The release configuration must use the actual certificate publisher.

After approval and a verified signed release, the relevant download/release pages will carry this attribution:

> Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

This prospective attribution does not claim current sponsorship or an issued certificate.

## Privacy and user control

See the [privacy statement](PRIVACY.md). HRig does not include advertising or automatic product-analytics/crash-report uploads. Connections, agent providers and integrations are selected by the operator; configured connections can continue polling while a workspace is open. Their traffic and data handling are explained in the privacy statement. Windows setup is per-user and provides an uninstaller; uninstall preserves application data.

## Onboarding and verification

The [SignPath application checklist](docs/SIGNPATH-APPLICATION.md) records the remaining steps. [Distribution policy](DISTRIBUTION.md) explains the existing certificate-based release path and updater gates. The [Foundation conditions](https://signpath.org/terms) and [GitHub integration documentation](https://docs.signpath.io/trusted-build-systems/github) govern eligibility and the eventual adapter. This policy is a project commitment, not a statement that SignPath has accepted the project.
