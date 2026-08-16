import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import CallPage from './pages/CallPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/call" element={<CallPage />} />
    </Routes>
  );
}
