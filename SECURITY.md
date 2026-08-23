# Security Policy

## Supported Versions

Currently, Pythinker Code only provides security support for the latest released version.

## Reporting a Vulnerability

We take security seriously. **Please do not open a public issue for security vulnerabilities.**

Preferred channel:

- GitHub Security Advisories — https://github.com/PyModel/pythinker-code/security/advisories/new
  (private disclosure, tracked with the codebase)

Alternative channel:

- Email: code@pythoughts.ai (please include "[security]" in the subject)

## What to Include

- Affected version (output of `pythinker --version`)
- Reproduction steps
- Impact assessment
- Any suggested mitigation

## Our Response

We triage Critical and High reports within 24 hours. We target a fix within 72 hours for
Critical and High issues, 7 days for Medium issues, and 30 days for Low issues.

## Dependency Vulnerability Policy

Pull requests cannot add a vulnerability at any severity. The repository uses a full-workspace
audit because build and package steps can ship workspace code declared as a development
dependency. A production-only audit is informational and is not a security gate.

If a vulnerability is disclosed after clean code reaches `main`, the response times above apply.
Dismissed or auto-dismissed alert state does not make a vulnerable dependency acceptable.

## Public Disclosure

We will coordinate with you on disclosure timing once a fix is ready.
