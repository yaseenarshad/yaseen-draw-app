/**
 * SETTINGS › SHARING (YAZ-1799 D7, prototype) — its own page in the Settings dialog, like Hotkeys.
 * Top to bottom: status → Set up sharing (Open Cloudflare + paste key + live progress) → this
 * vault's shared boards → custom domain → the plain-English write-up → disconnect / delete
 * everything.
 *
 * The key typed here goes to main once (`share:setup`) and is never shown or read back; the page
 * only ever learns "ready" or "not set up".
 */
import { useCallback, useEffect, useState } from 'react'
import { SHARE_SETUP_LABELS, SHARE_SETUP_STEPS, type ShareListEntry, type ShareSetupProgress, type ShareSetupStep, type ShareStatus } from '@shared/types'
import { api } from '../api'
import { basename, stripExt } from '../lib/paths'
import { isPending, onLiveShareChange } from './liveShare'
import { errorText, formatWhen, liveLine } from './ShareDialog'
import './share.css'

type StepState = 'pending' | ShareSetupProgress['state']
type Steps = Record<ShareSetupStep, { state: StepState; message?: string }>
const freshSteps = (): Steps => Object.fromEntries(SHARE_SETUP_STEPS.map((s) => [s, { state: 'pending' }])) as Steps
const ICON: Record<StepState, string> = { pending: '○', running: '⏳', done: '✅', failed: '❌' }

export function SharingPage({ root }: { root: string | null }) {
  const [status, setStatus] = useState<ShareStatus | null>(null)
  const [rows, setRows] = useState<ShareListEntry[] | null>(null)
  const [token, setToken] = useState('')
  const [steps, setSteps] = useState<Steps | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  /** More than one account behind the key: the picker, and which one is picked. */
  const [accountChoices, setAccountChoices] = useState<{ id: string; name: string }[] | null>(null)
  const [pickedAccount, setPickedAccount] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [domainBusy, setDomainBusy] = useState(false)
  const [domainMsg, setDomainMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [listMsg, setListMsg] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'none' | 'disconnect' | 'delete'>('none')
  const [dangerBusy, setDangerBusy] = useState(false)
  const [dangerMsg, setDangerMsg] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.share.status())
    } catch {
      setStatus(null)
    }
    if (root !== null) {
      try {
        setRows(await api.share.list(root))
      } catch (err) {
        setListMsg(errorText(err))
        setRows([])
      }
    }
  }, [root])

  const [, setTick] = useState(0)
  useEffect(() => {
    void refresh()
    const offMain = api.share.onChanged(() => void refresh())
    const offLocal = onLiveShareChange(() => setTick((t) => t + 1))
    return () => {
      offMain()
      offLocal()
    }
  }, [refresh])

  useEffect(
    () =>
      api.share.onSetupProgress((p) =>
        setSteps((prev) => {
          const next = { ...(prev ?? freshSteps()) }
          next[p.step] = { state: p.state, message: p.message }
          return next
        }),
      ),
    [],
  )

  /**
   * Set up: first ask which accounts the key sees. Exactly one → straight on. Several → show the
   * picker and wait for Continue (which calls this again with the pick).
   */
  const setup = async (accountId?: string) => {
    setSettingUp(true)
    setSetupError(null)
    if (accountId === undefined) {
      setSteps(null)
      try {
        const list = await api.share.accounts(token)
        if (list.length > 1) {
          setAccountChoices(list)
          setPickedAccount(list[0].id)
          setSettingUp(false)
          return
        }
      } catch (err) {
        setSetupError(errorText(err))
        setSettingUp(false)
        return
      }
    }
    setAccountChoices(null)
    setSteps(freshSteps())
    try {
      const s = await api.share.setup(token, accountId)
      setStatus(s)
      setToken('')
      setShowSetup(false)
    } catch (err) {
      setSetupError(errorText(err))
    } finally {
      setSettingUp(false)
    }
  }

  const attach = async (hostname: string | null) => {
    setDomainBusy(true)
    setDomainMsg(null)
    try {
      const s = await api.share.setDomain(hostname)
      setStatus(s)
      setDomain('')
      setDomainMsg({ ok: true, text: hostname === null ? 'Custom domain removed — links use the workers.dev address again.' : `Attached. New links (and every existing one) now use https://${s.customDomain}.` })
    } catch (err) {
      setDomainMsg({ ok: false, text: errorText(err) })
    } finally {
      setDomainBusy(false)
    }
  }

  const stopRow = async (row: ShareListEntry) => {
    if (root === null) return
    setListMsg(null)
    try {
      await api.share.stop({ root, path: row.path })
    } catch (err) {
      setListMsg(errorText(err))
    }
    void refresh()
  }

  const copyRow = async (id: string, url: string) => {
    await navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const disconnect = async (deleteEverything: boolean) => {
    setDangerBusy(true)
    setDangerMsg(null)
    try {
      setStatus(await api.share.disconnect(root, deleteEverything))
      setConfirm('none')
      setDangerMsg(deleteEverything ? 'Everything was deleted from your Cloudflare account and this computer forgot the key. Every link now shows “stopped”.' : 'Key forgotten. Links you already shared keep working (showing their last uploaded version), but nothing updates them until you set sharing up again.')
      void refresh()
    } catch (err) {
      setDangerMsg(errorText(err))
    } finally {
      setDangerBusy(false)
    }
  }

  const ready = status?.state === 'ready'
  const setupOpen = !ready || showSetup

  return (
    <div className="sharing-page" data-testid="sharing-page">
      {/* 1. Status */}
      <div className={`sharing-card sharing-status${ready ? ' sharing-status--ready' : ''}`} data-testid="sharing-status">
        <span className="sharing-status__dot" aria-hidden />
        {status === null ? (
          <span>…</span>
        ) : ready ? (
          <span>
            ✅ <strong>Sharing ready</strong> — links look like <code>{status.url}/b/…</code>
            {status.accountName !== null && <span className="share-dialog__muted"> · Cloudflare account: {status.accountName}</span>}
            {status.demo && status.workersDevUrl !== null && (
              <span className="share-dialog__muted">
                {' '}
                · DEMO: on real Cloudflare this would be {status.customDomain !== null ? `https://${status.customDomain}` : status.workersDevUrl}
              </span>
            )}
          </span>
        ) : (
          <span>
            <strong>Not set up</strong> — sharing uses your own free Cloudflare account. Set it up once below.
          </span>
        )}
      </div>

      {/* 2. Set up */}
      <div className="sharing-card">
        <h3>Set up sharing</h3>
        {!setupOpen ? (
          <div className="sharing-row">
            <span className="share-dialog__muted">Already set up. Run it again to repair it, or to use a different Cloudflare key.</span>
            <button type="button" className="share-btn" onClick={() => setShowSetup(true)}>
              Set up again
            </button>
            {steps !== null && steps.test.state === 'done' && (
              <ul className="sharing-steps" style={{ flexBasis: '100%' }} aria-label="Setup progress" data-testid="sharing-steps">
                {SHARE_SETUP_STEPS.map((s) => (
                  <li key={s} data-state={steps[s].state}>
                    <span className="sharing-steps__icon">{ICON[steps[s].state]}</span>
                    <span>{SHARE_SETUP_LABELS[s]}</span>
                    {steps[s].message !== undefined && <span className="sharing-steps__detail">{steps[s].message}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <ol style={{ margin: '0 0 10px', paddingLeft: 20 }}>
              <li>
                Press <strong>Open Cloudflare</strong>. Log in (or make a free account). The page opens with the right permissions already ticked — scroll down and press <em>Continue to summary</em>, then{' '}
                <em>Create Token</em>.
              </li>
              <li>Copy the key it shows you and paste it below, then press <strong>Set up</strong>. The app does the rest.</li>
            </ol>
            <div className="sharing-row">
              <button type="button" className="share-btn" onClick={() => void api.share.openCloudflare()}>
                Open Cloudflare
              </button>
              <input
                type="password"
                className="sharing-input"
                aria-label="Cloudflare API key"
                placeholder="Paste your Cloudflare API key"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setAccountChoices(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && token.trim() !== '' && !settingUp && accountChoices === null) void setup()
                }}
                disabled={settingUp}
                data-testid="sharing-token"
              />
              <button type="button" className="share-btn share-btn--primary" onClick={() => void setup()} disabled={settingUp || token.trim() === '' || accountChoices !== null} data-testid="sharing-setup">
                {settingUp ? 'Setting up' : 'Set up'}
              </button>
            </div>
            {accountChoices !== null && (
              <fieldset className="sharing-accounts" data-testid="sharing-accounts">
                <legend>This key can see {accountChoices.length} Cloudflare accounts. Which one should hold your shared boards?</legend>
                {accountChoices.map((a) => (
                  <label key={a.id} className="sharing-accounts__row">
                    <input type="radio" name="sharing-account" value={a.id} checked={pickedAccount === a.id} onChange={() => setPickedAccount(a.id)} />
                    <span>{a.name}</span>
                    <span className="share-dialog__muted">…{a.id.slice(-6)}</span>
                  </label>
                ))}
                <div className="sharing-row">
                  <button type="button" className="share-btn" onClick={() => setAccountChoices(null)}>
                    Cancel
                  </button>
                  <button type="button" className="share-btn share-btn--primary" onClick={() => pickedAccount !== null && void setup(pickedAccount)} data-testid="sharing-account-continue">
                    Continue
                  </button>
                </div>
              </fieldset>
            )}
            {steps !== null && (
              <ul className="sharing-steps" aria-label="Setup progress" data-testid="sharing-steps">
                {SHARE_SETUP_STEPS.map((s) => (
                  <li key={s} data-state={steps[s].state}>
                    <span className="sharing-steps__icon">{ICON[steps[s].state]}</span>
                    <span>{SHARE_SETUP_LABELS[s]}</span>
                    {steps[s].message !== undefined && <span className="sharing-steps__detail">{steps[s].message}</span>}
                  </li>
                ))}
              </ul>
            )}
            {setupError !== null && (steps === null || !Object.values(steps).some((st) => st.state === 'failed')) && (
              <p className="share-dialog__error" role="alert">
                {setupError}
              </p>
            )}
            {!settingUp && steps !== null && steps.test.state === 'done' && <p className="share-dialog__ok">✅ Sharing ready.</p>}
          </>
        )}
      </div>

      {/* 3. Shared boards */}
      <div className="sharing-card">
        <h3>Your shared boards{root !== null && <span className="share-dialog__muted"> — in {basename(root)}</span>}</h3>
        {root === null ? (
          <p className="share-dialog__muted">Open a vault to see its shared boards.</p>
        ) : rows === null ? (
          <p className="share-dialog__muted">…</p>
        ) : rows.length === 0 ? (
          <p className="share-dialog__muted">Nothing in this vault is shared. Right-click a board › Share, or File › Share Link (⌘⇧L).</p>
        ) : (
          <ul className="sharing-list" data-testid="sharing-list">
            {rows.map((row) => (
              <li key={row.id}>
                <span className="sharing-list__name" title={row.path}>
                  {stripExt(basename(row.path))}
                </span>
                <span className="sharing-list__meta" title={row.url}>
                  Anyone with the link can {row.allowDownload ? 'view and download' : 'view only'} · {row.url || '(set up sharing to see the link)'}
                </span>
                <span className="sharing-list__actions">
                  <button type="button" className="share-btn" onClick={() => void copyRow(row.id, row.url)} disabled={row.url === ''}>
                    {copiedId === row.id ? 'Copied ✓' : 'Copy link'}
                  </button>
                  <button type="button" className="share-btn share-btn--danger" onClick={() => void stopRow(row)} disabled={!ready}>
                    Stop sharing
                  </button>
                </span>
                {ready && row.fileExists && (() => {
                  const line = liveLine(row, isPending(row.path), Date.now())
                  return (
                    <span className="sharing-list__live" data-tone={line.tone}>
                      {line.text}
                    </span>
                  )
                })()}
                {row.live === 'missing' && row.sync.state !== 'uploading' && <span className="sharing-list__flag">⚠ Stale: the link doesn't work (its copy is gone from Cloudflare). Edit and save the board once to put it back, or Stop sharing to forget it.</span>}
                {row.live === 'unknown' && ready && <span className="sharing-list__flag">? Couldn't check this link right now (offline?).</span>}
                {!row.fileExists && <span className="sharing-list__flag">⚠ No board at this path any more (renamed, moved or deleted?). The link still shows the last version uploaded, and nothing updates it.</span>}
              </li>
            ))}
          </ul>
        )}
        {listMsg !== null && (
          <p className="share-dialog__error" role="alert">
            {listMsg}
          </p>
        )}
      </div>

      {/* 4. Custom domain */}
      <div className="sharing-card">
        <h3>Custom domain (optional)</h3>
        {status?.customDomain != null ? (
          <div className="sharing-row">
            <span>
              Links use <strong>https://{status.customDomain}</strong>
            </span>
            <button type="button" className="share-btn" onClick={() => void attach(null)} disabled={domainBusy}>
              Remove
            </button>
          </div>
        ) : (
          <div className="sharing-row">
            <input
              className="sharing-input"
              aria-label="Custom domain"
              placeholder="share.yourdomain.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={!ready || domainBusy}
              spellCheck={false}
              data-testid="sharing-domain"
            />
            <button type="button" className="share-btn share-btn--primary" onClick={() => void attach(domain)} disabled={!ready || domainBusy || domain.trim() === ''}>
              {domainBusy ? 'Attaching' : 'Attach'}
            </button>
          </div>
        )}
        {!ready && <p className="share-dialog__muted">Set up sharing first.</p>}
        {domainMsg !== null && <p className={domainMsg.ok ? 'share-dialog__ok' : 'share-dialog__error'}>{domainMsg.text}</p>}
      </div>

      {/* 5. The write-up */}
      <div className="sharing-card sharing-help">
        <h3>How sharing works</h3>
        <h4>What Share does</h4>
        <p>
          In a board's Share dialog, set <strong>General access</strong> to <em>Anyone with the link</em>. The app uploads the board — images packed in — and gives it one long random link. Then choose
          what people can do: <strong>view and download</strong> (the default: the page also has Download .excalidraw and Download PNG) or <strong>view only</strong> (just the board — zoom and pan). You
          can switch any time; the link stays the same and the change is instant. Nobody can edit and nobody needs an account. View only hides the buttons and your Worker refuses the download, but a
          determined viewer can still dig the drawing out of their browser, so don't treat it as copy protection. Links are unguessable, not secret-proof: whoever you send one to can pass it on.
        </p>
        <p>
          The link is <strong>live</strong>. Every time the board is saved, the app uploads the new version (once you've paused for about ten seconds) — people just refresh the page to see it. If an
          upload fails (say you're offline) the link keeps the last good version, the Share dialog says why, and the next save tries again.
        </p>
        <h4>Where it lives: your own Cloudflare</h4>
        <p>
          Nothing goes through a Yaseen Draw server — there isn't one. Setup creates two things in <em>your</em> Cloudflare account: a storage bucket (Cloudflare calls it <em>R2</em>) that holds the shared copies,
          and a <strong>Worker</strong>. A Worker is a tiny program Cloudflare runs for you on its servers; this one does three jobs: it accepts uploads from this app (protected by a password the app made up and
          keeps to itself), it shows the viewer page when someone opens a link, and it deletes a copy when you stop sharing.
        </p>
        <h4>What it costs</h4>
        <p>
          <strong>$0</strong> for normal use. Cloudflare's free tier includes 10 GB of R2 storage and 100,000 Worker requests a day — hundreds of shared boards and thousands of views. One catch: Cloudflare asks
          for a <strong>payment card on file</strong> before it switches R2 on, even on the free tier. If setup says R2 isn't enabled, open R2 in the Cloudflare dashboard, add a card, and run setup again. One
          upload can be at most 100 MB (a Cloudflare free-plan limit); the app checks before uploading.
        </p>
        <h4>Stopping and deleting</h4>
        <ul>
          <li>
            <strong>Not shared</strong> (in the Share dialog), or <strong>Stop sharing</strong> in the list above, deletes that board's copy from your bucket. The link stops working at once and shows
            “This link was stopped or never existed”.
          </li>
          <li>
            <strong>Delete all shared links from Cloudflare</strong> (below) deletes every shared copy, the Worker and the bucket from your Cloudflare account, and makes this computer forget the key.
          </li>
        </ul>
        <h4>Using your own domain</h4>
        <ol>
          <li>
            The domain has to be on your Cloudflare account first. This part is manual: in the Cloudflare dashboard press <em>Add a domain</em>, follow the steps, and change your domain's nameservers at the
            company you bought it from to the two Cloudflare gives you. Wait until Cloudflare shows the domain as <em>Active</em> (minutes to a day).
          </li>
          <li>
            Then type the address you want links on — for example <code>share.yourdomain.com</code> — into the box above and press Attach. The app connects it to your Worker; Cloudflare sets up the certificate by
            itself.
          </li>
        </ol>
      </div>

      {/* 6. Disconnect / delete everything */}
      <div className="sharing-card">
        <h3>Turn off sharing</h3>
        {confirm === 'none' ? (
          <div className="sharing-row">
            <button type="button" className="share-btn" onClick={() => setConfirm('disconnect')} disabled={!ready && status?.workerName == null}>
              Forget key on this Mac (links keep working)
            </button>
            <button type="button" className="share-btn share-btn--danger" onClick={() => setConfirm('delete')} disabled={!ready} data-testid="sharing-delete-everything">
              Delete all shared links from Cloudflare
            </button>
          </div>
        ) : (
          <div className="share-confirm">
            <p>
              {confirm === 'delete'
                ? `Delete every shared copy${root !== null ? ` (and this vault's list of shared boards)` : ''}, the Worker and the bucket from your Cloudflare account? Every link stops working at once. Your boards on this computer are not touched.`
                : 'Forget the Cloudflare key on this Mac? Links you already shared keep working and keep showing their last uploaded version, but saves no longer update them, and this app can\'t stop them until you set sharing up again.'}
            </p>
            <div className="share-dialog__actions">
              <button type="button" className="share-btn" onClick={() => setConfirm('none')} disabled={dangerBusy}>
                Cancel
              </button>
              <button type="button" className="share-btn share-btn--danger" onClick={() => void disconnect(confirm === 'delete')} disabled={dangerBusy}>
                {dangerBusy ? 'Working' : confirm === 'delete' ? 'Delete all shared links' : 'Forget key'}
              </button>
            </div>
          </div>
        )}
        {dangerMsg !== null && <p className="share-dialog__muted">{dangerMsg}</p>}
      </div>
    </div>
  )
}
