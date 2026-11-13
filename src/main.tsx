import React, { lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
const Gallery = lazy(() => import('./gallery/Gallery'));
const Service = lazy(() => import('./Service'));
const MusicRoom = lazy(() => import('./music/MusicRoom'));
const isMusic = (route: string) => route === '#music' || route.startsWith('#music/');
function Router() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const update = () => setRoute(location.hash); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  return <Suspense fallback={<p className="route-loading" role="status">Opening {route === '#service' ? 'the service panel' : isMusic(route) ? 'the music room' : 'the jukebox'}…</p>}>
    {route === '#service' ? <Service/> : isMusic(route) ? <MusicRoom/> : <Gallery/>}
  </Suspense>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Router/></React.StrictMode>);
