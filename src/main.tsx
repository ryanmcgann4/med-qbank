import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { ensureOrganization } from './lib/org';
import { startAutoSync } from './lib/sync/controller';

// File any lectures imported before folders existed, then start syncing.
void ensureOrganization().finally(startAutoSync);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
