/**
 * WordPress REST connectivity check.
 *
 * Reports exactly what the server answers for the two calls the publisher makes,
 * so a bot-challenge can be told apart from an auth or permissions failure
 * without having to publish anything. Nothing is written to the site: the media
 * probe is an OPTIONS preflight, not an upload.
 *
 * Usage:
 *   node scripts/wp-check.mjs https://example.com USER "app password"
 *
 * Credentials are read from argv or WP_SITE / WP_USER / WP_APP_PASSWORD so they
 * never have to be pasted into a file.
 */

const site = (process.argv[2] || process.env.WP_SITE || '').replace(/\/+$/, '');
const user = process.argv[3] || process.env.WP_USER || '';
const pass = (process.argv[4] || process.env.WP_APP_PASSWORD || '').replace(/\s+/g, '');

if (!site || !user || !pass) {
  console.error('usage: node scripts/wp-check.mjs <siteUrl> <username> <appPassword>');
  console.error('   or: WP_SITE=... WP_USER=... WP_APP_PASSWORD=... node scripts/wp-check.mjs');
  process.exit(2);
}

const USER_AGENT =
  process.env.PUBLISHER_USER_AGENT?.trim() ||
  'EducativeContentStudio/1.0 (+https://www.educative.io; automated content publisher)';

const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

function classify(status, headers, body) {
  if (headers.get('sg-captcha')) return 'BLOCKED — SiteGround sg-captcha challenge';
  if (/\/\.well-known\/(sgcaptcha|captcha)\//.test(body)) return 'BLOCKED — SiteGround sg-captcha challenge';
  if (headers.get('cf-mitigated') || /cf_chl_opt|Just a moment\.\.\./.test(body)) return 'BLOCKED — Cloudflare challenge';
  if (status === 202 && !/^\s*[[{]/.test(body)) return 'BLOCKED — proof-of-work challenge (202, non-JSON)';
  if (status === 401 || status === 403) return 'AUTH — credentials rejected or user lacks rights';
  if (!/^\s*[[{]/.test(body)) return 'BLOCKED — non-JSON body, something sits in front of the REST API';
  if (status >= 200 && status < 300) return 'OK — reached WordPress';
  return `HTTP ${status}`;
}

async function probe(label, url, init) {
  process.stdout.write(`\n${label}\n  ${init.method} ${url}\n`);
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    console.log(`  NETWORK ERROR: ${e?.message}`);
    return null;
  }
  const body = await res.text();
  const interesting = ['content-type', 'server', 'sg-captcha', 'cf-mitigated', 'cf-ray', 'x-powered-by'];
  console.log(`  status:  ${res.status} ${res.statusText}`);
  for (const h of interesting) {
    const v = res.headers.get(h);
    if (v) console.log(`  ${h}: ${v}`);
  }
  console.log(`  verdict: ${classify(res.status, res.headers, body)}`);
  const snippet = body.replace(/\s+/g, ' ').slice(0, 220);
  if (snippet) console.log(`  body:    ${snippet}${body.length > 220 ? '…' : ''}`);
  return res;
}

const headers = {
  Authorization: auth,
  Accept: 'application/json',
  'User-Agent': USER_AGENT,
};

console.log(`site:       ${site}`);
console.log(`user:       ${user}`);
console.log(`User-Agent: ${USER_AGENT}`);

await probe('[1] REST root — is the API reachable at all?', `${site}/wp-json/`, { method: 'GET', headers });
await probe('[2] Authenticated identity — are the credentials accepted?', `${site}/wp-json/wp/v2/users/me`, {
  method: 'GET',
  headers,
});
await probe('[3] Media endpoint preflight — the call that was being challenged', `${site}/wp-json/wp/v2/media`, {
  method: 'OPTIONS',
  headers,
});

console.log(`
Reading the result:
  All three OK            -> headers are accepted; publishing should work.
  [1]/[2] OK, [3] BLOCKED -> the rule is specific to the media endpoint.
  All three BLOCKED       -> the WAF is not keying on the User-Agent. It is most
                             likely TLS (JA4) fingerprinting, which no header can
                             change from Node. Ask the host to allowlist this
                             User-Agent or the server IP, or to exempt /wp-json/.
  AUTH                    -> not a bot problem: re-check the Application Password
                             and that the user can upload media.
`);
