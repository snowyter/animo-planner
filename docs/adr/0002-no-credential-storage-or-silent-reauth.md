# No credential storage and no silent re-authentication

The student signs in to Archer's Hub manually, in a popup pointed at the university's own site. Nothing about that login is read, intercepted, autofilled, or persisted, in memory or on disk. Silent re-auth was considered and rejected.

Three reasons it stays rejected. The login field is labelled `Password/OTP`, implying a second factor that stored credentials could not satisfy anyway. A public MIT repository containing a credential-capture path is a ready-made template for a lookalike phishing fork — the code would be doing the phishing author's work for them. And persisted session cookies already solve the actual annoyance, reducing expiry to one click, rarely, on a screen the student is already looking at.

## Consequences

- Session expiry mid-refresh is a supported, designed-for state rather than an error, and must keep partial results.
- There is deliberately no credential-handling code in the codebase for a reviewer to have to audit.
