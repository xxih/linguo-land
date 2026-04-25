import React from 'react';
import ReactDOM from 'react-dom/client';
import Options from './Options';
import { ErrorBoundary } from '../lib/ErrorBoundary';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="Options">
      <Options />
    </ErrorBoundary>
  </React.StrictMode>,
);
