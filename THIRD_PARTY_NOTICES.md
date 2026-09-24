# Third-party notices

Organelle depends on third-party open-source software. The authoritative dependency
versions are recorded in `package-lock.json`; each installed package's license and
notice files remain authoritative.

The direct runtime packages are distributed under permissive licenses (primarily MIT,
ISC, BSD, and Apache-2.0): React and React DOM, Next.js, Auth.js/NextAuth.js,
PostgreSQL.js, TanStack Query, D3 and related chart packages, Radix UI, Lucide, Zod,
date-fns, csv-parse, Zustand, Sonner, Tailwind utilities, and class-name utilities.

Notable transitive or bundled licenses reviewed for distribution include libvips under
LGPL-3.0-or-later (dynamically used by Sharp), Lightning CSS and axe-core under MPL-2.0,
caniuse data under CC-BY-4.0, argparse under Python-2.0, and d3-flextree under WTFPL.
Their license texts are available in the respective installed packages and upstream
distributions. Container SBOMs preserve exact package/version inventory.

Before a release, maintainers must review the complete transitive inventory and the
generated image SBOM. Dependencies with copyleft, source-available, unknown, or
unlicensed metadata require explicit maintainer review and an update to this file.
