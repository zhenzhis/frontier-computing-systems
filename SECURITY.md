# Security

Do not submit API keys, OAuth tokens, cookies, account lists, sessions or private
task ledgers in issues or pull requests. Keep secrets in authorized provider
configuration outside the repository. If a credential leaks, revoke/rotate it
through its provider; removing a file alone is not sufficient.

The bounded worker allows scoped file tools and blocks other tool calls, but it
is not an OS sandbox. Dependencies and trusted check commands can execute code.
Token limits are checked at response boundaries and are not hard billing caps.
An abort is not proof that an external effect did not occur. Resume checks must
inspect actual state before repeating effects.

Windows permission patterns are a reviewed starting profile, not exhaustive
shell safety. The optional adapter uses the upstream permission engine and
PowerShell AST normalization. Validate custom tools and nested MCP/Codemode
routes in an isolated profile before adoption.

Report a suspected vulnerability privately using GitHub private vulnerability
reporting if available. If unavailable, contact the maintainer through their
GitHub profile without publishing exploit details or secrets.
