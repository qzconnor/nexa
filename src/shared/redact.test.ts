import { describe, expect, it } from 'vitest'
import { MASK, redactSecrets } from './redact'

const masked = (text: string) => redactSecrets(text).text
/** A made-up token, put together at run time: whole in the source, secret scanners would take it for a real one. */
const fake = (...parts: string[]) => parts.join('')

describe('redactSecrets', () => {
  it('masks tokens by their shape', () => {
    const tokens = [
      fake('sk-ant-', 'oat01-abcdefghijklmnopqrstuvwxyz0123456789'),
      fake('sk-proj-', 'abcdefghijklmnopqrstuvwxyz012345'),
      fake('ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
      fake('github_pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'),
      fake('glpat-', 'abcdefghijklmnopqrst'),
      fake('xoxb-', '123456789012-abcdefghijkl'),
      fake('AKIA', 'IOSFODNN7EXAMPLE'),
      fake('AIza', 'SyA-abcdefghijklmnopqrstuvwxyz01234'),
      fake('sk_', 'live_', 'abcdefghijklmnopqrstuvwx'),
      fake('npm_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
      fake('hf_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
      fake('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'),
    ]
    for (const token of tokens) {
      expect(masked(`Token: ${token} fertig`), token).not.toContain(token.slice(8))
    }
  })

  it('masks settings, variables and fields by their name', () => {
    expect(masked('API_KEY=abc123 node server.js')).toBe(`API_KEY=${MASK} node server.js`)
    expect(masked('$env:GITHUB_TOKEN = "geheim"')).toBe(`$env:GITHUB_TOKEN = ${MASK}`)
    expect(masked('export DB_PASSWORD=hunter2')).toBe(`export DB_PASSWORD=${MASK}`)
    expect(masked('{"password": "hunter2", "user": "anna"}')).toBe(`{"password": ${MASK}, "user": "anna"}`)
    expect(masked('Server=db;User Id=sa;Password=Hunter2!;')).toBe(`Server=db;User Id=sa;Password=${MASK};`)
    expect(masked('client_secret: abc')).toBe(`client_secret: ${MASK}`)
    expect(masked('//registry.npmjs.org/:_authToken=abcdef')).toBe(`//registry.npmjs.org/:_authToken=${MASK}`)
  })

  it('masks the values of flags', () => {
    expect(masked('psql --password hunter2 -h db')).toBe(`psql --password ${MASK} -h db`)
    expect(masked('gh auth login --with-token=abc')).toBe(`gh auth login --with-token=${MASK}`)
    expect(masked('New-LocalUser -Name anna -Password $pw')).toBe(`New-LocalUser -Name anna -Password ${MASK}`)
    expect(masked('mysql -uroot -pHunter2 shop')).toBe(`mysql -uroot -p${MASK} shop`)
  })

  it('masks credentials in URLs and headers', () => {
    expect(masked('git clone https://anna:hunter2@github.com/a/b.git')).toBe(`git clone https://anna:${MASK}@github.com/a/b.git`)
    expect(masked('mongodb+srv://app:s3cr3t@cluster0.example.net/db')).toBe(`mongodb+srv://app:${MASK}@cluster0.example.net/db`)
    expect(masked('curl -H "Authorization: Bearer abc.def.ghi" https://api')).toBe(`curl -H "Authorization: Bearer ${MASK}" https://api`)
  })

  it('masks private keys whole', () => {
    const key = fake('-----BEGIN OPENSSH ', 'PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nAAAA\n-----END OPENSSH ', 'PRIVATE KEY-----')
    expect(masked(`cat id_ed25519\n${key}\n`)).toBe(`cat id_ed25519\n-----BEGIN OPENSSH PRIVATE KEY----- ${MASK} -----END OPENSSH PRIVATE KEY-----\n`)
  })

  it('masks what looks like a key without a name', () => {
    expect(masked('Q2hhbmdlTWVQbGVhc2UxMjM0NTY3ODkwYWJjZGVm')).toBe(MASK)
  })

  it('leaves ordinary output alone', () => {
    const output = [
      'On branch main',
      'commit 4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39',
      'Author: Anna <anna@example.com>',
      'id 2f2591e1-0000-4000-8000-000000000001',
      'F:\\Projekte\\Apps\\nexa\\src\\renderer\\src\\components\\chat\\MessageList.vue',
      'node_modules/@lucide/vue/dist/esm/icons/chevrons-down-up.mjs',
      'password: required',
      'TOKEN=${GITHUB_TOKEN}',
      'tokens: 1234 in, 56 out',
    ].join('\n')
    expect(redactSecrets(output)).toEqual({ text: output, count: 0 })
  })

  it('counts what it masked', () => {
    expect(redactSecrets('A_TOKEN=abc B_SECRET=def').count).toBe(2)
  })
})
