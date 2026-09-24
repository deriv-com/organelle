# Contributing

Thank you for improving Organelle. Start with a GitHub issue for substantial behavior,
schema, security, or API changes so the design can be agreed before implementation.

## Development workflow

1. Use Node.js 24 and PostgreSQL 17.
2. Run `npm ci`, copy `.env.example` to `.env`, and start the database with
   `docker compose up -d db`.
3. Run `npm run db:migrate`, then `npm run db:seed:demo` for synthetic data.
4. Make focused changes with tests. Never add real employee data, credentials, private
   URLs, or generated environment files.
5. Run `make check` and the PostgreSQL suite described in
   [docs/development.md](docs/development.md).

Pull requests must explain the motivation, user impact, tests, database and security
effects, and documentation changes. Breaking schema changes require an upgrade and
rollback note. Maintainers may request smaller commits or additional tests.

`npm run check:references` always detects generic private hostnames and cloud-account
identifiers. Project maintainers can additionally configure the newline-delimited
`PUBLIC_REFERENCE_DENYLIST` repository secret for CI. Keep its values out of source
control, workflow arguments, artifacts, and logs; scanner failures intentionally report
only the affected file.

## Developer Certificate of Origin

All commits must include a DCO sign-off certifying that you have the right to contribute
the work under this project's license:

```text
Signed-off-by: Your Name <your.email@example.com>
```

Use `git commit -s`. The sign-off is a statement that you agree to the
[Developer Certificate of Origin 1.1](https://developercertificate.org/).

## Conduct and licensing

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributions are
accepted under Apache-2.0. Do not submit code or assets whose licensing is unclear.
