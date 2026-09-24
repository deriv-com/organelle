# Directory import

The initial import accepts UTF-8 CSV with these exact columns:

```text
employee_id,email,full_name,manager_employee_id,job_title,position_level,org_path,status,office_location,office_country,avatar_url
```

`employee_id`, `email`, and `full_name` are required. `manager_employee_id` refers to
another row and is blank for a root leader. `org_path` contains `>`-separated
organization units, for example `Engineering > Platform`. Status is one of `joining`,
`active`, `serving_notice`, `inactive`, or `resigned`. Position level is an optional
integer from 0 through 99.

Always dry-run first:

```bash
npm run org:import -- --file organization.csv --organization-name "Example Organization"
```

With `DATABASE_ADMIN_URL` configured, apply transactionally:

```bash
npm run org:import -- --file organization.csv --organization-name "Example Organization" --apply
npm run admin:bootstrap -- --email administrator@example.com
```

Apply is allowed only when both trees and employees are empty. Any invalid row rolls
back the entire transaction. The importer rejects duplicate IDs or normalized emails,
missing managers, self-management, cycles, invalid email/status/level values,
organization paths deeper than 12 units, and reporting hierarchies deeper than 16
people. It creates published version 1 and validates the resulting tree.

`npm run db:seed:demo` imports the entirely synthetic example and bootstraps
`admin@example.com`. Never replace the checked-in example with real workforce data.
