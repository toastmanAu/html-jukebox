import React from 'react';
import ReactDOM from 'react-dom/client';
import { ccc } from '@ckb-ccc/connector-react';
import { createPudgeClient } from './ckbfs/client';
import App from './App';
const client = createPudgeClient();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ccc.Provider name="CKBFS AI HTML Jukebox" defaultClient={client} clientOptions={[{ name: 'Pudge / Testnet', client }]} signerFilter={async signer => signer.signer.signType === ccc.SignerSignType.JoyId}><App/></ccc.Provider></React.StrictMode>);
