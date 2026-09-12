import { lazy, Suspense, useEffect, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { createPudgeClient } from './ckbfs/client';
import { formatDiagnostic } from './ckbfs/errors';
import { authorizeService } from './admin/access';
const App = lazy(() => import('./App'));
const client = createPudgeClient();
function ServiceGate() {
  const signer = ccc.useSigner(); const wallet = ccc.useCcc();
  const [access, setAccess] = useState<{ signer: typeof signer; owner: boolean }>();
  const [error, setError] = useState(''), [checking, setChecking] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false; setAccess(undefined); setError('');
    if (!signer) { setChecking(false); return; }
    setChecking(true);
    authorizeService(signer).then(result => { if (!cancelled) setAccess({ signer, owner: result.owner }); }).catch(e => { if (!cancelled) setError(formatDiagnostic(e)); }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [signer, retry]);
  return <><a className="service-home" href="#jukebox">← Back to the jukebox</a>
    {signer && access?.signer === signer ? <>{!access.owner && <p className="gate">Admin panel access granted. Catalog transactions require the registry owner JoyID account.</p>}<Suspense fallback={<p className="route-loading" role="status">Opening authorized service panel…</p>}><App/></Suspense></> :
      <main className="service-gate"><p className="eyebrow">CKBFS / OWNER ACCESS</p><h1>Service panel.</h1><p className="lede">Connect an authorized JoyID account on Pudge to open the cabinet.</p><button onClick={() => wallet.open()}>{signer ? 'Change JoyID account' : 'Connect JoyID'}</button>
        <p role="status">{checking ? 'Checking Pudge and the live registry owner lock…' : signer ? 'Authorization required.' : 'Service controls remain locked until your JoyID lock is verified.'}</p>
        {error && <div className="error" role="alert">{error}</div>}{signer && <button disabled={checking} onClick={() => setRetry(v => v + 1)}>Retry authorization</button>}
      </main>}
  </>;
}
export default function Service() {
  return <ccc.Provider name="CKBFS AI HTML Jukebox" defaultClient={client} clientOptions={[{ name: 'Pudge / Testnet', client }]} signerFilter={async signer => signer.signer.signType === ccc.SignerSignType.JoyId}><ServiceGate/></ccc.Provider>;
}
