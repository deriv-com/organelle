# Changelog

All notable changes are documented here. The project follows Semantic Versioning after
1.0; pre-1.0 releases may include breaking changes with upgrade notes.

## Unreleased

- Refresh the pinned Node.js 24 runtime and remove unused bundled package managers from
  the application image.

- Preserve primary-seat choices and surface concurrent primary-seat conflicts during
  merge review; synchronize replaced occupants and explicitly restore deleted parents.
- Restrict undo and redo to the current user’s top command, recheck publishing roles
  inside the commit transaction, and refresh shared history permissions while open.
- Add sandbox history search and action/person filters, with history available to
  explicitly shared Admins.
- Improve chart search keyboard navigation, responsive sandbox controls, assistant
  collapse, and reporting-manager display for shared seats.
- Keep error deduplication local to each request and scan proposed public files
  regardless of extension.

- Release publication awaits written authorization for Apache-2.0 relicensing and use of
  the Organelle name and icon.

## 0.1.0 - 2026-09-24

### Added

- Self-hosted organization chart, directory, sandbox editing and sharing, merge review,
  audit history, version restore, and CSV reports.
- Generic OpenID Connect authentication, five-role authorization, and scoped machine API
  keys.
- PostgreSQL 17 baseline, transactional CSV onboarding, synthetic demo organization,
  checked migrations, and least-privileged runtime role.
- Container deployment, optional HTTPS proxy, public operations documentation, security
  automation, and open-source community files.
