import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Gallery from './pages/Gallery.jsx';
import Upload from './pages/Upload.jsx';
import Categories from './pages/Categories.jsx';
import Files from './pages/Files.jsx';
import Rejected from './pages/Rejected.jsx';
import Settings from './pages/Settings.jsx';
import MobileUnlockPage from './pages/MobileUnlockPage.jsx';

export default function App() {
  const { user, booting } = useApp();
  if (booting) return <div className="boot"><span className="spinner" /></div>;
  if (!user) return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/unlock-request" element={<MobileUnlockPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
  return (
    <Routes>
      <Route path="/unlock-request" element={<MobileUnlockPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/files" element={<Files />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/rejected" element={<Rejected />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
