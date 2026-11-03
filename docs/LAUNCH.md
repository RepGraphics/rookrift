# A focused route to a paid Rookrift pilot

Rookrift's product promise: **give survival community owners their evenings back**. The initial buyer is an owner running two to twenty ARK servers who already coordinates admins in Discord. The product should win on clear setup, dependable saves and announcements, and alerts the owner trusts. A successful business is an outcome to validate, not something this code guarantees.

## Phase 1 — prove the daily job

Recruit five to ten owners with real ASE and ASA communities. Include at least two hosting providers and a self-hosted cluster. Help each connect one test server first, then measure whether they can connect the second unaided. Record setup failures and support minutes per community. Avoid adding more games until the ARK workflow is dependable.

Test the proposed £9/£24 monthly pricing with those owners. Ask what they currently use, what takes the most time, what they would miss if Rookrift disappeared, and whether they will actually subscribe. Keep both games in every tier; charge for operational scale rather than forcing a game upgrade.

Ship a public landing page and a brief video showing a real save, a Discord command, an alert, and adding another server. Publish practical RCON setup guides for the hosts your pilots actually use. Seek permission from community owners before publishing quotes or logos. The current login page and hosted demo can support product review; the public acquisition site is a separate launch task.

## Phase 2 — launch a small paid beta

Before taking money, complete real Discord, Stripe test-mode, and ARK end-to-end checks. Verify failure handling, canceled and delinquent subscriptions, downgrade preservation, task recovery after restart, and database restoration. Visually review mobile and desktop layouts. Exercise the Docker build and HTTPS proxy on your deployment host.

Create your real service identity, support address, privacy/data retention policies, cancellation/refund rules, and legal business details. Confirm the final name/domain is suitable through your own brand clearance process; the development name search was not trademark clearance. Set prices and tax presentation to match your actual merchant setup. Establish a process for deleting customer accounts, clearing their stored server credentials, and handling data exports before broad acquisition.

Use a transparent beta label and modest service promises. Explain that game hosting is separate and that world saves are not backups. Publish integration limitations. Start with a manageable cohort rather than selling an uptime SLA this single-process deployment cannot yet support.

## Phase 3 — measure and invest

Track consented aggregate product events with a selected analytics service before paid acquisition. Suggested initial targets are hypotheses:

| Metric | Initial question |
| --- | --- |
| Activation | What fraction connect a real server and run one successful command within a day? |
| Setup time | Can a new owner reach a successful RCON check in under ten minutes? |
| Reliability | What share of scheduled commands complete, and how quickly are failures seen? |
| Retention | Do activated communities still use Rookrift weekly after four weeks? |
| Conversion | Do multi-server owners move from Scout to a paid tier without manual selling? |
| Support cost | How many support minutes does each paid workspace require each month? |
| Unit economics | Does revenue cover hosting, payment fees, refunds, tax, and support? |

Do not display fabricated testimonials, customer counts, or uptime claims. In-product demo metrics are sample data only. Add recovery/restart controls through specific host APIs or a host agent only when pilot demand justifies that engineering and trust boundary.

Prioritize retention and connection reliability before referral rewards, annual billing, broad paid ads, or DayZ. When ARK pilots are staying and paying, implement DayZ behind a capability flag, recruit a separate DayZ test cohort, and validate its BattlEye transport with real hosting providers.

## Reference material

- [Discord OAuth documentation](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx)
- [Discord application commands](https://docs.discord.com/developers/docs/interactions/slash-commands)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [ARK community server configuration](https://ark.wiki.gg/wiki/Server_configuration) (community reference; verify with your provider)
