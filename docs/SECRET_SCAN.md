# Pre-publication secret check

Before creating the public repository, Gitleaks 8.30.1 scanned all five existing commits and all 99 publishable working-tree files. Both scans reported no leaks. The official release binary was verified against its published SHA-256 checksum.

Environment files, dependencies, build output, browser test artifacts, and local Wrangler state are excluded by `.gitignore`. Cloudflare and GitHub credentials were used through existing local authentication and are not included in this repository. Public CKB addresses, lock hashes, transaction hashes, and deployment constants are intentional application configuration/evidence.

This records the scan performed for initial publication; it is not a guarantee against every possible secret. Re-run a secret scan before publishing credentials-related changes.
