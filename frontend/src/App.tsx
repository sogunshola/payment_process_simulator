import { Route, Routes } from 'react-router-dom';
import { TopNav } from './components/layout/TopNav';
import { Arena } from './pages/Arena';
import { Console } from './pages/Console';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <>
      <TopNav />
      <main className="mx-auto max-w-page px-gutter py-12">
        <Routes>
          <Route path="/" element={<Console />} />
          <Route path="/arena" element={<Arena />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}
