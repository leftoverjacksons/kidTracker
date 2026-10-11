import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/* Ionic core + utility CSS */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
/* Dark theme follows the phone's system setting */
import '@ionic/react/css/palettes/dark.system.css';
import './theme/app.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
