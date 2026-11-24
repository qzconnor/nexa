/**
 * Secrets in what the user's own shell (`!` in the composer) ran and printed, masked before anything
 * keeps or passes it on: the chat's file on disk, which the agents can read with their file tools, and
 * the prompt that hands the commands to the CLI. Better too much than too little: a masked word in an
 * ordinary output costs little, a token that gets through can't be taken back.
 */

export const MASK = '••••'

/** Names of settings, variables, fields and flags whose value is a secret. */
const SECRET_NAME =
  '[\\w.-]*?(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credentials?|auth(?!or)|session[_-]?id|cookie|signature|salt)[\\w.-]*'

/** A value: in quotes (as written), or up to the next space or separator. */
const VALUE = `("[^"\\n]*"|'[^'\\n]*'|[^\\s"',;&|)]+)`

interface Rule {
  pattern: RegExp
  /** What stands in place of a hit; by default the mask. */
  replace?: (match: string, ...groups: string[]) => string
}

const RULES: Rule[] = [
  // Private keys, whole: PEM blocks (RSA, EC, OpenSSH, PGP …).
  {
    pattern: /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?(?:-----END \1-----|$)/g,
    replace: (_m, kind: string) => `-----BEGIN ${kind}----- ${MASK} -----END ${kind}-----`,
  },
  // Tokens by their shape: Anthropic, OpenAI, GitHub, GitLab, Slack, AWS, Google, Stripe, npm,
  // Hugging Face, SendGrid, DigitalOcean, Shopify, PyPI, JWTs.
  {
    pattern:
      /\b(?:sk-ant-[\w-]{10,}|sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abeoprs]-[\w-]{10,}|(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}|AIza[\w-]{35}|ya29\.[\w-]{20,}|[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{30,}|SG\.[\w-]{16,}\.[\w-]{16,}|dop_v1_[a-f0-9]{64}|shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}|pypi-[\w-]{50,}|eyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,})/g,
  },
  // Credentials in URLs: `scheme://user:password@host`.
  {
    pattern: /\b([a-z][\w+.-]*:\/\/[^\s:/@]+):([^\s@/]+)@/gi,
    replace: (_m, head: string) => `${head}:${MASK}@`,
  },
  // Authorization headers: the scheme stays, the credentials go.
  {
    pattern: /\b((?:proxy-)?authorization\s*[:=]\s*["']?(?:bearer|basic|token|digest|negotiate)?\s*)[^\s"',;]+/gi,
    replace: (_m, head: string) => `${head}${MASK}`,
  },
  // Flags with a secret as their value: `--password x`, `--api-key=x`, `-Password x` (PowerShell).
  {
    pattern: new RegExp(`(^|\\s)(--?${SECRET_NAME})(\\s+|=)${VALUE}`, 'gim'),
    replace: (m, lead: string, flag: string, gap: string, value: string) => (value.startsWith('-') ? m : `${lead}${flag}${gap}${MASK}`),
  },
  // MySQL's password glued to its flag: `mysql -uroot -pgeheim`.
  {
    pattern: /(\bmysql(?:dump|admin)?\b[^\n]*?\s-p)([^\s-][^\s]*)/gi,
    replace: (_m, head: string) => `${head}${MASK}`,
  },
  // Settings, variables and fields: `API_KEY=x`, `$env:GITHUB_TOKEN = "x"`, `"password": "x"`,
  // `Password=x;` in a connection string, `export SECRET=x`.
  {
    pattern: new RegExp(`(\\$?(?:env:)?\\b${SECRET_NAME}["']?\\s*(?::|=|:=)\\s*)${VALUE}`, 'gi'),
    // A number after „tokens“ counts them (`input_tokens: 1234`); one after a password stays a secret.
    replace: (m, head: string, value: string) => (isPlainValue(value) || (/tokens\b/i.test(head) && /^\d+$/.test(value)) ? m : `${head}${MASK}`),
  },
  // What is left that looks like a key: long, with upper and lower case letters and digits, as no
  // word, hash or path has them (git's hashes and UUIDs are lower case hex and stay).
  {
    pattern: /(?<![\w/\\.-])[A-Za-z0-9+/_-]{32,}={0,2}(?![\w/\\.-])/g,
    replace: (m) => (/[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m) && !/^[A-Za-z]+(?:[-_][A-Za-z]+)*$/.test(m) ? MASK : m),
  },
]

/** A value that isn't one: empty, masked already, a placeholder, a variable, or a yes or no. */
function isPlainValue(value: string): boolean {
  const bare = value.replace(/^["']|["']$/g, '')
  return (
    bare === '' ||
    bare.includes(MASK) ||
    /^(?:true|false|null|none|undefined|yes|no|on|off|required|optional|\*+|x{3,}|<[^>]*>|\$\{?[\w:]+\}?|%\w+%)$/i.test(bare)
  )
}

/** The text with its secrets masked, and how many it had. */
export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0
  let result = text
  for (const rule of RULES) {
    result = result.replace(rule.pattern, (...args: unknown[]) => {
      const match = args[0] as string
      // The groups, without the offset, whole text and named groups the callback gets after them.
      const groups = args.slice(1).filter((a): a is string => typeof a === 'string' || a === undefined).slice(0, -1) as string[]
      const next = rule.replace ? rule.replace(match, ...groups.map((g) => g ?? '')) : MASK
      if (next !== match) count++
      return next
    })
  }
  return { text: result, count }
}
