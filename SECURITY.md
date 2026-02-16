# Security Policy

Thank you for helping keep this project and its users safe. We take security vulnerabilities seriously and appreciate
your efforts to responsibly disclose any issues you find.

## Supported Versions

The following versions of this project are currently receiving security updates:

| Version | Supported          |
|---------|--------------------|
| 1.5.x   | :white_check_mark: |
| 1.1.0   | :x:                |
| < 1.1   | :x:                |

> **Note:** We recommend always using the latest stable release to ensure you have the most recent security patches.

## Reporting a Vulnerability

### How to Report

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, please report them via one of the following methods:

- **GitHub Security Advisories (Preferred):**
    - Use [GitHub's private vulnerability reporting feature](../../security/advisories/new) to submit a report directly
      through this repository.

### What to Include

To help us triage and respond quickly, please include as much of the following information as possible:

- **Type of vulnerability** (e.g., SQL injection, XSS, buffer overflow, authentication bypass)
- **Affected component(s)** (file paths, modules, or functions involved)
- **Version(s) affected**
- **Step-by-step reproduction instructions**
- **Proof-of-concept or exploit code** (if available)
- **Impact assessment** (what an attacker could achieve)
- **Any suggested remediation** (if you have ideas)

### What to Expect

| Stage                             | Timeframe          |
|-----------------------------------|--------------------|
| Initial acknowledgment            | Within 48 hours    |
| Status update                     | Within 7 days      |
| Vulnerability assessment complete | Within 14 days     |
| Patch development (if applicable) | Varies by severity |

We will keep you informed throughout the process and work with you to understand and resolve the issue. Once the
vulnerability is confirmed:

- **If accepted:** We will work on a fix, coordinate a release timeline with you, and credit you in the security
  advisory (unless you prefer to remain anonymous).
- **If declined:** We will provide a detailed explanation of why the report does not qualify as a security
  vulnerability.

## Disclosure Policy

We follow a **coordinated disclosure** process:

1. Reporter submits vulnerability privately
2. We acknowledge and investigate
3. We develop and test a fix
4. We coordinate a disclosure date with the reporter
5. We release the patch and publish a security advisory
6. Reporter may publish their findings after the advisory is public

We aim to resolve critical vulnerabilities within **30 days** and request that reporters refrain from public disclosure
until a fix is available or 90 days have passed, whichever comes first.

## Safe Harbor

We consider security research conducted in accordance with this policy to be:

- **Authorized** under applicable anti-hacking laws
- **Exempt** from restrictions in our Terms of Service that would interfere with security research
- **Lawful, helpful, and conducted in good faith**

We will not pursue legal action against researchers who:

- Act in good faith and follow this policy
- Avoid privacy violations, data destruction, and service disruption
- Do not exploit vulnerabilities beyond what is necessary to demonstrate the issue
- Report findings promptly and do not disclose publicly before coordinated disclosure

## Scope

### In Scope

- Source code in this repository
- Official releases and packages
- Project documentation that could lead to security issues
- Configuration files and deployment scripts in this repository

### Out of Scope

- Third-party dependencies (please report to the respective maintainers)
- Social engineering attacks
- Physical security attacks
- Denial of service attacks
- Issues in forked repositories not maintained by us
- Vulnerabilities in outdated/unsupported versions

## Security Best Practices for Users

- Always use the latest supported version
- Review the changelog before upgrading for security-related updates
- Subscribe to security advisories for this repository (Watch → Custom → Security alerts)
- Report any suspicious behavior promptly

## Recognition

We believe in recognizing the valuable contributions of security researchers. With your permission, we will:

- Credit you in the security advisory
- Add you to our [SECURITY_ACKNOWLEDGMENTS.md](SECURITY_ACKNOWLEDGMENTS.md) file
- Provide a letter of acknowledgment upon request

---

*This security policy is based on industry best practices and is licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).*
