import { lazy, Suspense } from 'react';
import { createHashRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { AddQuestionsPage } from './pages/AddQuestionsPage';
import { DataPage } from './pages/DataPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { QuizBuilderPage } from './pages/QuizBuilderPage';
import { QuizPage } from './pages/QuizPage';
import { QuizReviewPage } from './pages/QuizReviewPage';

// Charts are the heaviest dependency; only load them on the Stats page.
const StatsPage = lazy(() => import('./pages/StatsPage'));

// Hash routing so deep links work on any static host (GitHub Pages has no SPA fallback).
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/add', element: <AddQuestionsPage /> },
      { path: '/quiz/new', element: <QuizBuilderPage /> },
      { path: '/quiz/:id', element: <QuizPage /> },
      { path: '/quiz/:id/review', element: <QuizReviewPage /> },
      { path: '/library', element: <LibraryPage /> },
      { path: '/library/f/:folderId', element: <LibraryPage /> },
      { path: '/library/:lectureId', element: <LibraryPage /> },
      {
        path: '/stats',
        element: (
          <Suspense fallback={null}>
            <StatsPage />
          </Suspense>
        ),
      },
      { path: '/data', element: <DataPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
