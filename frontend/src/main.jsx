import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <h1>Plant Watering Dashboard</h1>;
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
