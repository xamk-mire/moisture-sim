import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import MoistureDashboard from './MoistureDashboard';
const el = document.getElementById('root')!;
createRoot(el).render(
  <React.StrictMode>
    <MoistureDashboard />
  </React.StrictMode>
);
