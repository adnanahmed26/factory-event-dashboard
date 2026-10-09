const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

// Inspect Git's actual commit candidate list without printing matching secret values.
const staged = process.argv.includes('--staged');
const args = staged
  ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
  : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
const files = [
  ...new Set(execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean)),
];
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['API secret', /\bsk-(?:proj-|live_|test_|svcacct-)[A-Za-z0-9_-]{16,}\b/],
  [
    'credential assignment',
    /\b(?:api[_-]?key|api[_-]?secret|access[_-]?token|client[_-]?secret|password|passwd|secret[_-]?key)\s*[:=]\s*["']([^"'\r\n]{8,})["']/i,
  ],
  [
    'URL credentials',
    /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|https?):\/\/[^\s/:]+:([^\s@]+)@/i,
  ],
];
const findings = [];
for (const file of files) {
  const normalized = file.replaceAll('\\', '/');
  if (
    /(?:^|\/)(?:\.env(?:\..+)?|credentials[^/]*|service-account[^/]*|[^/]+\.(?:pem|key|p12|pfx|jks))$/.test(
      normalized,
    ) &&
    !normalized.endsWith('.env.example')
  ) {
    findings.push({ file, reason: 'Sensitive filename selected for commit' });
  }
  const buffer = staged ? execFileSync('git', ['show', ':' + file]) : readFileSync(file);
  if (buffer.includes(0) || /\.(?:png|jpe?g|gif|webp|ico|pdf|zip)$/i.test(file)) continue;
  const lines = buffer.toString('utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [reason, pattern] of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      // This published literal is used exclusively by the loopback-only demo database.
      if (match[1] === 'local-development-only') continue;
      // Documentation placeholders are deliberately non-functional.
      if (match[1] && /^<[^>]+>$/.test(match[1])) continue;
      findings.push({ file, line: index + 1, reason });
    }
  });
}
if (findings.length) {
  console.error(JSON.stringify({ scannedFiles: files.length, findings }, null, 2));
  process.exitCode = 1;
} else
  console.log(
    `Secret scan passed: ${files.length} ${staged ? 'staged' : 'tracked/unignored'} files. No detected secrets.`,
  );
